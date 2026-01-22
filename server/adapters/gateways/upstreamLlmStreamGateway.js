/**
 * 文件：upstreamLlmStreamGateway.js
 * 模块：server/adapters/gateways
 * 作用：上游 LLM 流式调用（SSE -> 文本增量），用于后端统一输出 SSE（避免前端做 provider 兼容）
 * 依赖：server/shared、server/utils、providers 兼容参数（但不复用透传）
 * @created 2026-01-11
 * @modified 2026-01-20
 */

import { createAbortController, readErrorText } from "../../utils/http.js";
import { iterateSseEvents } from "../../utils/sse.js";
import { extractDeltaFromJson, safeJsonParse } from "./upstreamLlmStreamDelta.js";
import { normalizeBaseUrl, pickUpstream, UPSTREAM_PROVIDERS } from "../../shared/upstreamConfig.js";

const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_MAKERSUITE_BASE_URL = "https://generativelanguage.googleapis.com";
const DEFAULT_VERTEX_REGION = "us-central1";
const DEFAULT_GEMINI_API_VERSION = "v1beta";

function normalizeText(value) {
  return String(value ?? "").trim();
}

function coerceText(value) {
  const text = String(value ?? "");
  return text.length > 0 ? text : "\u200b";
}

function buildOpenAiHeaders(apiKey) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function buildOpenAiUrl(baseUrl) {
  const u = String(baseUrl || "").replace(/\/$/, "");
  return `${u}/chat/completions`;
}

function splitLeadingSystemAsTextBlocks(messages) {
  const system = [];
  let idx = 0;
  while (idx < messages.length && messages[idx]?.role === "system") {
    system.push(coerceText(messages[idx]?.content));
    idx += 1;
  }
  return { system, rest: messages.slice(idx) };
}

function toClaudeMessages(messages, useSystemPrompt) {
  const list = Array.isArray(messages) ? messages : [];
  const { system, rest } = useSystemPrompt ? splitLeadingSystemAsTextBlocks(list) : { system: [], rest: list };
  const normalized = rest.map((m) => {
    const role = m?.role === "assistant" ? "assistant" : "user";
    return { role, content: [{ type: "text", text: coerceText(m?.content) }] };
  });
  if (normalized.length === 0) normalized.push({ role: "user", content: [{ type: "text", text: "\u200b" }] });
  return { system: system.map((text) => ({ type: "text", text })), messages: normalized };
}

function buildAnthropicHeaders(apiKey) {
  return {
    "Content-Type": "application/json",
    "anthropic-version": ANTHROPIC_VERSION,
    "anthropic-beta": "output-128k-2025-02-19",
    "x-api-key": apiKey,
  };
}

function isClaudeThinkingCapableModel(model) {
  return /^claude-(3-7|opus-4|sonnet-4|haiku-4-5)/.test(String(model || ""));
}

function calculateClaudeBudgetTokens(maxTokens, effort) {
  const max = Math.max(0, Math.trunc(Number(maxTokens || 0)));
  switch (String(effort || "auto")) {
    case "min":
      return 1024;
    case "low":
      return Math.max(1024, Math.floor(max * 0.1));
    case "medium":
      return Math.max(1024, Math.floor(max * 0.25));
    case "high":
      return Math.max(1024, Math.floor(max * 0.5));
    case "max":
      return Math.max(1024, Math.floor(max * 0.95));
    case "auto":
    default:
      return null;
  }
}

function buildClaudeRequestBody({ requestBody, useSystemPrompt, reasoningEffort }) {
  const converted = toClaudeMessages(requestBody.messages, useSystemPrompt);
  const budgetTokens = isClaudeThinkingCapableModel(requestBody.model) ? calculateClaudeBudgetTokens(requestBody.max_tokens, reasoningEffort) : null;

  const body = {
    model: requestBody.model,
    messages: converted.messages,
    max_tokens: requestBody.max_tokens,
    temperature: requestBody.temperature,
    top_p: requestBody.top_p,
    top_k: requestBody.top_k,
    stream: true,
  };
  if (useSystemPrompt && converted.system.length) body.system = converted.system;
  if (budgetTokens !== null) {
    body.thinking = { type: "enabled", budget_tokens: budgetTokens };
    delete body.temperature;
    delete body.top_p;
    delete body.top_k;
  }
  return body;
}

function toGeminiPrompt(messages, useSystemPrompt) {
  const list = Array.isArray(messages) ? messages : [];
  const { system, rest } = useSystemPrompt ? splitLeadingSystemAsTextBlocks(list) : { system: [], rest: list };

  const contents = rest.map((m) => {
    const role = m?.role === "assistant" ? "model" : "user";
    return { role, parts: [{ text: coerceText(m?.content) }] };
  });

  const systemInstruction = { parts: system.map((text) => ({ text })) };
  return { contents, systemInstruction };
}

function isGeminiThinkingConfigModel(model) {
  const m = String(model || "");
  return (/^gemini-2.5-(flash|pro)/.test(m) && !/-image(-preview)?$/.test(m)) || /^gemini-3-pro/.test(m);
}

function calculateGeminiThinkingBudget(maxTokens, effort, model) {
  const max = Math.max(0, Math.trunc(Number(maxTokens || 0)));
  const e = String(effort || "auto");
  if (!isGeminiThinkingConfigModel(model)) return null;
  if (e === "auto") return null;
  if (e === "min") return String(model || "").includes("flash") ? 0 : 128;
  if (e === "low") return Math.floor(max * 0.1);
  if (e === "medium") return Math.floor(max * 0.25);
  if (e === "high") return Math.floor(max * 0.5);
  if (e === "max") return max;
  return null;
}

function buildMakerSuiteUrl({ baseUrl, apiKey, model }) {
  const trimmed = String(baseUrl || DEFAULT_MAKERSUITE_BASE_URL).trim().replace(/\/$/, "");
  return `${trimmed}/${DEFAULT_GEMINI_API_VERSION}/models/${encodeURIComponent(model)}:streamGenerateContent?key=${encodeURIComponent(apiKey)}&alt=sse`;
}

function normalizeVertexBaseUrl(baseUrl) {
  const trimmed = String(baseUrl || "").trim().replace(/\/$/, "");
  return trimmed.replace(/\/v1$/, "");
}

function buildVertexExpressUrl({ baseUrl, apiKey, model, region, projectId }) {
  const r = String(region || DEFAULT_VERTEX_REGION).trim() || DEFAULT_VERTEX_REGION;
  const key = encodeURIComponent(apiKey);
  const normalizedBase = normalizeVertexBaseUrl(baseUrl);

  if (projectId) {
    const host = normalizedBase || "https://aiplatform.googleapis.com";
    return `${host}/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(r)}/publishers/google/models/${encodeURIComponent(model)}:streamGenerateContent?key=${key}&alt=sse`;
  }

  const host = normalizedBase || (r === "global" ? "https://aiplatform.googleapis.com" : `https://${encodeURIComponent(r)}-aiplatform.googleapis.com`);
  return `${host}/v1/publishers/google/models/${encodeURIComponent(model)}:streamGenerateContent?key=${key}&alt=sse`;
}

function buildGeminiRequestBody({ requestBody, useSystemPrompt, reasoningEffort, includeReasoning }) {
  const prompt = toGeminiPrompt(requestBody.messages, useSystemPrompt);
  const generationConfig = {
    maxOutputTokens: requestBody.max_tokens,
    temperature: requestBody.temperature,
    topP: requestBody.top_p,
    topK: requestBody.top_k,
  };

  const body = { contents: prompt.contents, generationConfig };
  if (Array.isArray(prompt.systemInstruction?.parts) && prompt.systemInstruction.parts.length) body.systemInstruction = prompt.systemInstruction;

  const budget = calculateGeminiThinkingBudget(requestBody.max_tokens, reasoningEffort, requestBody.model);
  if (budget !== null) body.generationConfig.thinkingConfig = { includeThoughts: Boolean(includeReasoning), thinkingBudget: budget };
  return body;
}

async function streamFromUpstream({ req, upstreamRes, onDelta }) {
  let assistantText = "";
  for await (const evt of iterateSseEvents(upstreamRes.body)) {
    if (evt.data === "[DONE]") break;
    const json = safeJsonParse(evt.data);
    const delta = extractDeltaFromJson(json);
    if (!delta) continue;
    assistantText += delta;
    if (typeof onDelta === "function") onDelta(delta);
  }
  return assistantText;
}

/**
 * 中文注释：
 * createUpstreamLlmStreamGateway({ req })
 * 作用：创建请求级上游流式网关（解析上游 SSE 并产出文本增量）
 * 约束：不透传上游 SSE；不落库 apiKey；连接断开时 abort 上游
 * 参数：
 *  - req: Express Request（用于 close abort）
 * 返回：{ streamChat }
 */
export function createUpstreamLlmStreamGateway({ req }) {
  const streamChat = async ({ upstream, requestBody, providerOptions, onDelta, abortSignal }) => {
    const picked = pickUpstream(upstream || {});
    const provider = normalizeText(picked?.provider || UPSTREAM_PROVIDERS.OPENAI) || UPSTREAM_PROVIDERS.OPENAI;
    const body = { ...(requestBody || {}), stream: true };

    const controller = createAbortController({ req, signal: abortSignal });
    const startedAt = Date.now();

    if (provider === UPSTREAM_PROVIDERS.OPENAI) {
      if (!picked.baseUrl) return { ok: false, assistantText: "", error: "OpenAI Base URL 不能为空。", debug: {} };
      const baseUrl = normalizeBaseUrl(picked.baseUrl);
      const url = buildOpenAiUrl(baseUrl);
      const upstreamRes = await fetch(url, {
        method: "POST",
        headers: buildOpenAiHeaders(picked.apiKey),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const latencyMs = Date.now() - startedAt;
      if (!upstreamRes.ok) return { ok: false, assistantText: "", error: await readErrorText(upstreamRes), debug: { latencyMs, status: upstreamRes.status } };
      const assistantText = await streamFromUpstream({ req, upstreamRes, onDelta });
      return { ok: true, assistantText, debug: { latencyMs, status: upstreamRes.status } };
    }

    if (provider === UPSTREAM_PROVIDERS.CLAUDE) {
      const apiKey = normalizeText(picked.apiKey);
      if (!apiKey) return { ok: false, assistantText: "", error: "Claude API Key 不能为空。", debug: {} };
      const baseUrl = picked.baseUrl ? normalizeBaseUrl(picked.baseUrl) : DEFAULT_ANTHROPIC_BASE_URL;
      const useSystemPrompt = providerOptions?.useSystemPrompt !== false;
      const reasoningEffort = normalizeText(providerOptions?.reasoningEffort || "auto");
      const upstreamRes = await fetch(`${baseUrl}/messages`, {
        method: "POST",
        headers: buildAnthropicHeaders(apiKey),
        body: JSON.stringify(buildClaudeRequestBody({ requestBody: body, useSystemPrompt, reasoningEffort })),
        signal: controller.signal,
      });
      const latencyMs = Date.now() - startedAt;
      if (!upstreamRes.ok) return { ok: false, assistantText: "", error: await readErrorText(upstreamRes), debug: { latencyMs, status: upstreamRes.status } };
      const assistantText = await streamFromUpstream({ req, upstreamRes, onDelta });
      return { ok: true, assistantText, debug: { latencyMs, status: upstreamRes.status } };
    }

    if (provider === UPSTREAM_PROVIDERS.MAKERSUITE || provider === UPSTREAM_PROVIDERS.VERTEXAI) {
      const apiKey = normalizeText(picked.apiKey);
      if (!apiKey) return { ok: false, assistantText: "", error: "Gemini API Key 不能为空。", debug: {} };

      const useSystemPrompt = providerOptions?.useSystemPrompt !== false;
      const reasoningEffort = normalizeText(providerOptions?.reasoningEffort || "auto");
      const includeReasoning = Boolean(providerOptions?.includeReasoning);

      const url =
        provider === UPSTREAM_PROVIDERS.VERTEXAI
          ? buildVertexExpressUrl({ baseUrl: picked.baseUrl, apiKey, model: body.model, region: picked.region, projectId: picked.projectId })
          : buildMakerSuiteUrl({ baseUrl: picked.baseUrl, apiKey, model: body.model });

      const upstreamRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildGeminiRequestBody({ requestBody: body, useSystemPrompt, reasoningEffort, includeReasoning })),
        signal: controller.signal,
      });
      const latencyMs = Date.now() - startedAt;
      if (!upstreamRes.ok) return { ok: false, assistantText: "", error: await readErrorText(upstreamRes), debug: { latencyMs, status: upstreamRes.status } };
      const assistantText = await streamFromUpstream({ req, upstreamRes, onDelta });
      return { ok: true, assistantText, debug: { latencyMs, status: upstreamRes.status } };
    }

    // fallback：按 OpenAI 兼容处理
    if (!picked.baseUrl) return { ok: false, assistantText: "", error: "Upstream Base URL 不能为空。", debug: {} };
    const baseUrl = normalizeBaseUrl(picked.baseUrl);
    const url = buildOpenAiUrl(baseUrl);
    const upstreamRes = await fetch(url, {
      method: "POST",
      headers: buildOpenAiHeaders(picked.apiKey),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;
    if (!upstreamRes.ok) return { ok: false, assistantText: "", error: await readErrorText(upstreamRes), debug: { latencyMs, status: upstreamRes.status } };
    const assistantText = await streamFromUpstream({ req, upstreamRes, onDelta });
    return { ok: true, assistantText, debug: { latencyMs, status: upstreamRes.status } };
  };

  return { streamChat };
}
