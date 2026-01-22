/**
 * 文件：openai.js
 * 模块：server/providers
 * 作用：OpenAI 兼容 Chat Completions 代理（支持非流式 + SSE 原样透传）
 * 依赖：fetch、server/utils/http
 * @created 2025-12-28
 * @modified 2026-01-20
 */

import { createAbortController, pipeSseToExpress, readErrorText } from "../utils/http.js";

function buildHeaders(apiKey) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function buildUrl(baseUrl) {
  const u = String(baseUrl || "").replace(/\/$/, "");
  return `${u}/chat/completions`;
}

// 中文注释：
// proxyOpenAIChatCompletions({ req, res, upstream, requestBody, abortSignal })
// 作用：代理到 OpenAI 兼容 /chat/completions；stream=true 时原样透传 SSE
// 约束：stream=true 不返回 JSON debug；stream=false 返回 assistantText + debug
// 参数：
//  - req/res: Express req/res
//  - upstream: { baseUrl:string, apiKey?:string }
//  - requestBody: {model:string,messages:any[],temperature?:number,top_p?:number,max_tokens?:number,stream?:boolean}
//  - abortSignal?: AbortSignal
// 返回：Promise<{ok:boolean, streamed:boolean, assistantText?:string, debug?:any, error?:string}>
export async function proxyOpenAIChatCompletions({ req, res, upstream, requestBody, abortSignal }) {
  const controller = createAbortController({ req, signal: abortSignal });

  const url = buildUrl(upstream.baseUrl);
  const headers = buildHeaders(upstream.apiKey);
  const startedAt = Date.now();
  const upstreamRes = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
    signal: controller.signal,
  });
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

  const text = json?.choices?.[0]?.message?.content ?? json?.choices?.[0]?.text ?? "";
  return { ok: true, streamed: false, assistantText: String(text || ""), debug };
}
