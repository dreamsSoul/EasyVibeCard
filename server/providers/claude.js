/**
 * 文件：claude.js
 * 模块：server/providers
 * 作用：Claude（Anthropic Messages API）代理（支持非流式 + SSE 原样透传）
 * 依赖：fetch、server/utils/http
 * @created 2025-12-28
 * @modified 2026-01-20
 */

import { createAbortController, pipeSseToExpress, readErrorText } from "../utils/http.js";

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";

const REASONING_EFFORT = Object.freeze({
  auto: "auto",
  min: "min",
  low: "low",
  medium: "medium",
  high: "high",
  max: "max",
});

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || DEFAULT_BASE_URL).trim().replace(/\/$/, "");
}

function buildHeaders(apiKey, betaHeaders) {
  const headers = {
    "Content-Type": "application/json",
    "anthropic-version": ANTHROPIC_VERSION,
    "x-api-key": apiKey,
  };
  const beta = Array.isArray(betaHeaders) ? betaHeaders.filter(Boolean) : [];
  if (beta.length) headers["anthropic-beta"] = beta.join(",");
  return headers;
}

function coerceTextContent(value) {
  const text = String(value ?? "");
  return text.length > 0 ? text : "\u200b";
}

function splitLeadingSystem(messages) {
  const system = [];
  let idx = 0;
  while (idx < messages.length && messages[idx]?.role === "system") {
    system.push({ type: "text", text: coerceTextContent(messages[idx]?.content) });
    idx += 1;
  }
  return { system, rest: messages.slice(idx) };
}

function toClaudeMessages(messages, useSystemPrompt) {
  const list = Array.isArray(messages) ? messages : [];
  const { system, rest } = useSystemPrompt ? splitLeadingSystem(list) : { system: [], rest: list };

  const normalized = rest.map((m) => {
    const role = m?.role === "assistant" ? "assistant" : "user";
    return { role, content: [{ type: "text", text: coerceTextContent(m?.content) }] };
  });

  if (normalized.length === 0) normalized.push({ role: "user", content: [{ type: "text", text: "\u200b" }] });
  return { system, messages: normalized };
}

function isThinkingCapableModel(model) {
  return /^claude-(3-7|opus-4|sonnet-4|haiku-4-5)/.test(String(model || ""));
}

function calculateBudgetTokens(maxTokens, effort, stream) {
  const max = Math.max(0, Math.trunc(Number(maxTokens || 0)));
  switch (effort) {
    case REASONING_EFFORT.min:
      return 1024;
    case REASONING_EFFORT.low:
      return Math.max(1024, Math.floor(max * 0.1));
    case REASONING_EFFORT.medium:
      return Math.max(1024, Math.floor(max * 0.25));
    case REASONING_EFFORT.high:
      return Math.max(1024, Math.floor(max * 0.5));
    case REASONING_EFFORT.max:
      return Math.max(1024, Math.floor(max * 0.95));
    case REASONING_EFFORT.auto:
    default:
      return null;
  }
}

function buildClaudeRequestBody({ requestBody, useSystemPrompt, reasoningEffort }) {
  const converted = toClaudeMessages(requestBody.messages, useSystemPrompt);
  const budgetTokens = isThinkingCapableModel(requestBody.model) ? calculateBudgetTokens(requestBody.max_tokens, reasoningEffort, requestBody.stream) : null;

  const body = {
    model: requestBody.model,
    messages: converted.messages,
    max_tokens: requestBody.max_tokens,
    temperature: requestBody.temperature,
    top_p: requestBody.top_p,
    top_k: requestBody.top_k,
    stream: Boolean(requestBody.stream),
  };

  if (useSystemPrompt && converted.system.length) body.system = converted.system;
  if (budgetTokens !== null) {
    body.thinking = { type: "enabled", budget_tokens: budgetTokens };
    delete body.temperature;
    delete body.top_p;
    delete body.top_k;
  }

  return { body, betaHeaders: ["output-128k-2025-02-19"] };
}

async function fetchClaudeMessages({ req, baseUrl, headers, body, abortSignal }) {
  const controller = createAbortController({ req, signal: abortSignal });
  const startedAt = Date.now();
  const upstreamRes = await fetch(`${baseUrl}/messages`, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
  return { upstreamRes, latencyMs: Date.now() - startedAt };
}

function extractAssistantText(json) {
  const blocks = Array.isArray(json?.content) ? json.content : [];
  const texts = blocks.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text);
  if (texts.length > 0) return texts.join("\n\n");
  const fallback = json?.content?.[0]?.text;
  return typeof fallback === "string" ? fallback : "";
}

async function handleStream({ upstreamRes, res, latencyMs }) {
  if (!upstreamRes.ok) {
    const error = await readErrorText(upstreamRes);
    return { ok: false, streamed: true, error, debug: { latencyMs, status: upstreamRes.status } };
  }
  await pipeSseToExpress({ upstreamRes, res });
  return { ok: true, streamed: true };
}

async function handleNonStream({ upstreamRes, latencyMs }) {
  const json = await upstreamRes.json().catch(() => null);
  const debug = { latencyMs, status: upstreamRes.status, json };
  if (!upstreamRes.ok) {
    const error = json?.error?.message || json?.message || `${upstreamRes.status} ${upstreamRes.statusText}`;
    return { ok: false, streamed: false, error, debug };
  }
  return { ok: true, streamed: false, assistantText: extractAssistantText(json), debug };
}

// 中文注释：
// proxyClaudeMessages({ req, res, upstream, requestBody, providerOptions, abortSignal })
// 作用：代理到 Anthropic /v1/messages；stream=true 时原样透传 SSE
// 约束：当前仅处理 text；不实现 tools/多模态；thinking 仅按 reasoningEffort 开启
// 参数：
//  - upstream: { baseUrl?:string, apiKey:string }
//  - providerOptions: { useSystemPrompt?:boolean, reasoningEffort?:string }
// 返回：Promise<{ok:boolean, streamed:boolean, assistantText?:string, debug?:any, error?:string}>
export async function proxyClaudeMessages({ req, res, upstream, requestBody, providerOptions, abortSignal }) {
  const apiKey = String(upstream.apiKey || "").trim();
  if (!apiKey) return { ok: false, streamed: Boolean(requestBody.stream), error: "Claude API Key 不能为空。" };

  const baseUrl = normalizeBaseUrl(upstream.baseUrl);
  const useSystemPrompt = providerOptions?.useSystemPrompt !== false;
  const reasoningEffort = String(providerOptions?.reasoningEffort || REASONING_EFFORT.auto);

  const { body, betaHeaders } = buildClaudeRequestBody({ requestBody, useSystemPrompt, reasoningEffort });
  const headers = buildHeaders(apiKey, betaHeaders);
  const { upstreamRes, latencyMs } = await fetchClaudeMessages({ req, baseUrl, headers, body, abortSignal });

  if (body.stream) return handleStream({ upstreamRes, res, latencyMs });
  return handleNonStream({ upstreamRes, latencyMs });
}
