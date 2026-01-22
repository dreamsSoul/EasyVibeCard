/**
 * 文件：gemini.js
 * 模块：server/providers
 * 作用：Gemini（Google AI Studio / Vertex AI）代理（支持非流式 + SSE 原样透传）
 * 依赖：fetch、server/utils/http
 * @created 2025-12-28
 * @modified 2026-01-20
 */

import { createAbortController, pipeSseToExpress, readErrorText } from "../utils/http.js";

const PROVIDERS = Object.freeze({
  MAKERSUITE: "makersuite",
  VERTEXAI: "vertexai",
});

const REASONING_EFFORT = Object.freeze({
  auto: "auto",
  min: "min",
  low: "low",
  medium: "medium",
  high: "high",
  max: "max",
});

const DEFAULT_MAKERSUITE_BASE_URL = "https://generativelanguage.googleapis.com";
const DEFAULT_VERTEX_REGION = "us-central1";
const DEFAULT_GEMINI_API_VERSION = "v1beta";

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/$/, "");
}

function normalizeVertexBaseUrl(baseUrl) {
  const trimmed = normalizeBaseUrl(baseUrl);
  return trimmed.replace(/\/v1$/, "");
}

function coerceText(value) {
  const text = String(value ?? "");
  return text.length > 0 ? text : "\u200b";
}

function splitLeadingSystem(messages) {
  const system = [];
  let idx = 0;
  while (idx < messages.length && messages[idx]?.role === "system") {
    system.push(coerceText(messages[idx]?.content));
    idx += 1;
  }
  return { system, rest: messages.slice(idx) };
}

function toGeminiPrompt(messages, useSystemPrompt) {
  const list = Array.isArray(messages) ? messages : [];
  const { system, rest } = useSystemPrompt ? splitLeadingSystem(list) : { system: [], rest: list };

  const contents = rest.map((m) => {
    const role = m?.role === "assistant" ? "model" : "user";
    return { role, parts: [{ text: coerceText(m?.content) }] };
  });

  const systemInstruction = { parts: system.map((text) => ({ text })) };
  return { contents, systemInstruction };
}

function isThinkingConfigModel(model) {
  const m = String(model || "");
  return (/^gemini-2.5-(flash|pro)/.test(m) && !/-image(-preview)?$/.test(m)) || /^gemini-3-pro/.test(m);
}

function calculateThinkingBudget(maxTokens, effort, model) {
  const max = Math.max(0, Math.trunc(Number(maxTokens || 0)));
  if (!isThinkingConfigModel(model)) return null;
  if (effort === REASONING_EFFORT.auto) return null;
  if (effort === REASONING_EFFORT.min) return model.includes("flash") ? 0 : 128;
  if (effort === REASONING_EFFORT.low) return Math.floor(max * 0.1);
  if (effort === REASONING_EFFORT.medium) return Math.floor(max * 0.25);
  if (effort === REASONING_EFFORT.high) return Math.floor(max * 0.5);
  if (effort === REASONING_EFFORT.max) return max;
  return null;
}

function buildMakerSuiteUrl({ baseUrl, apiKey, model, stream }) {
  const trimmed = String(baseUrl || DEFAULT_MAKERSUITE_BASE_URL).trim().replace(/\/$/, "");
  const responseType = stream ? "streamGenerateContent" : "generateContent";
  const alt = stream ? "&alt=sse" : "";
  return `${trimmed}/${DEFAULT_GEMINI_API_VERSION}/models/${encodeURIComponent(model)}:${responseType}?key=${encodeURIComponent(apiKey)}${alt}`;
}

function buildVertexExpressUrl({ baseUrl, apiKey, model, stream, region, projectId }) {
  const r = String(region || DEFAULT_VERTEX_REGION).trim() || DEFAULT_VERTEX_REGION;
  const responseType = stream ? "streamGenerateContent" : "generateContent";
  const alt = stream ? "&alt=sse" : "";
  const key = encodeURIComponent(apiKey);

  const normalizedBase = normalizeVertexBaseUrl(baseUrl);

  if (projectId) {
    const host = normalizedBase || "https://aiplatform.googleapis.com";
    return `${host}/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(r)}/publishers/google/models/${encodeURIComponent(model)}:${responseType}?key=${key}${alt}`;
  }

  const host = normalizedBase || (r === "global" ? "https://aiplatform.googleapis.com" : `https://${encodeURIComponent(r)}-aiplatform.googleapis.com`);
  return `${host}/v1/publishers/google/models/${encodeURIComponent(model)}:${responseType}?key=${key}${alt}`;
}


function extractAssistantText({ json, includeReasoning }) {
  const candidates = Array.isArray(json?.candidates) ? json.candidates : [];
  const parts = candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";

  const filtered = includeReasoning ? parts : parts.filter((p) => !p?.thought);
  return filtered.map((p) => (typeof p?.text === "string" ? p.text : "")).filter(Boolean).join("\n\n");
}

function buildBody({ prompt, requestBody, includeReasoning, reasoningEffort }) {
  const generationConfig = {
    maxOutputTokens: requestBody.max_tokens,
    temperature: requestBody.temperature,
    topP: requestBody.top_p,
    topK: requestBody.top_k,
  };

  const body = { contents: prompt.contents, generationConfig };
  if (Array.isArray(prompt.systemInstruction?.parts) && prompt.systemInstruction.parts.length) body.systemInstruction = prompt.systemInstruction;

  const budget = calculateThinkingBudget(requestBody.max_tokens, reasoningEffort, requestBody.model);
  if (budget !== null) body.generationConfig.thinkingConfig = { includeThoughts: Boolean(includeReasoning), thinkingBudget: budget };
  return body;
}

function buildUrl({ provider, upstream, requestBody }) {
  if (provider === PROVIDERS.VERTEXAI) {
    return buildVertexExpressUrl({
      baseUrl: upstream.baseUrl,
      apiKey: upstream.apiKey,
      model: requestBody.model,
      stream: Boolean(requestBody.stream),
      region: upstream.region,
      projectId: upstream.projectId,
    });
  }
  return buildMakerSuiteUrl({ baseUrl: upstream.baseUrl, apiKey: upstream.apiKey, model: requestBody.model, stream: Boolean(requestBody.stream) });
}

// 中文注释：
// proxyGemini({ req, res, provider, upstream, requestBody, providerOptions, abortSignal })
// 作用：代理 Gemini（AI Studio/Vertex）generateContent/streamGenerateContent；stream=true 原样透传 SSE
// 约束：当前仅处理文本 parts；不实现工具/多模态；thinkingConfig 仅在特定模型启用
// 返回：Promise<{ok:boolean, streamed:boolean, assistantText?:string, debug?:any, error?:string}>
export async function proxyGemini({ req, res, provider, upstream, requestBody, providerOptions, abortSignal }) {
  const apiKey = String(upstream.apiKey || "").trim();
  if (!apiKey) return { ok: false, streamed: Boolean(requestBody.stream), error: "Gemini API Key 不能为空。" };

  const useSystemPrompt = providerOptions?.useSystemPrompt !== false;
  const reasoningEffort = String(providerOptions?.reasoningEffort || REASONING_EFFORT.auto);
  const includeReasoning = Boolean(providerOptions?.includeReasoning);

  const prompt = toGeminiPrompt(requestBody.messages, useSystemPrompt);
  const body = buildBody({ prompt, requestBody, includeReasoning, reasoningEffort });
  const url = buildUrl({ provider, upstream, requestBody });

  const controller = createAbortController({ req, signal: abortSignal });
  const startedAt = Date.now();
  const upstreamRes = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
  const latencyMs = Date.now() - startedAt;

  if (requestBody.stream) {
    if (!upstreamRes.ok) {
      const error = await readErrorText(upstreamRes);
      return { ok: false, streamed: true, error, debug: { latencyMs, status: upstreamRes.status } };
    }
    await pipeSseToExpress({ upstreamRes, res });
    return { ok: true, streamed: true };
  }

  const json = await upstreamRes.json().catch(() => null);
  const debug = { latencyMs, status: upstreamRes.status, json };
  if (!upstreamRes.ok) {
    const error = json?.error?.message || json?.message || `${upstreamRes.status} ${upstreamRes.statusText}`;
    return { ok: false, streamed: false, error, debug };
  }
  return { ok: true, streamed: false, assistantText: extractAssistantText({ json, includeReasoning }), debug };
}
