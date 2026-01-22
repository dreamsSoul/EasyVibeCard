/**
 * 文件：apiV1ChatThreads.js
 * 模块：shared/api
 * 作用：Chat Threads API（/api/v1/chat/threads）
 * 依赖：apiV1Client、shared/api/sse
 * @created 2026-01-11
 * @modified 2026-01-11
 */

import { apiV1FetchJson } from "./apiV1Client";
import { iterateSseEvents } from "./sse";

function encodeThreadId(threadId) {
  return encodeURIComponent(String(threadId || ""));
}

function safeJsonParse(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
}

export async function createApiV1ChatThread(body) {
  return await apiV1FetchJson("/api/v1/chat/threads", { method: "POST", body: body || {} });
}

export async function getApiV1ChatThread(threadId) {
  return await apiV1FetchJson(`/api/v1/chat/threads/${encodeThreadId(threadId)}`);
}

export async function patchApiV1ChatThread(threadId, patch) {
  return await apiV1FetchJson(`/api/v1/chat/threads/${encodeThreadId(threadId)}`, { method: "PATCH", body: patch || {} });
}

export async function listApiV1ChatThreadMessages(threadId, { beforeSeq, limit } = {}) {
  const q = new URLSearchParams();
  if (beforeSeq !== undefined && beforeSeq !== null && beforeSeq !== "") q.set("beforeSeq", String(beforeSeq));
  if (limit !== undefined && limit !== null && limit !== "") q.set("limit", String(limit));
  const suffix = q.toString() ? `?${q}` : "";
  return await apiV1FetchJson(`/api/v1/chat/threads/${encodeThreadId(threadId)}/messages${suffix}`);
}

export async function clearApiV1ChatThreadMessages(threadId) {
  return await apiV1FetchJson(`/api/v1/chat/threads/${encodeThreadId(threadId)}/clear`, { method: "POST", body: {} });
}

export async function turnApiV1ChatThread(threadId, body) {
  return await apiV1FetchJson(`/api/v1/chat/threads/${encodeThreadId(threadId)}/turn`, { method: "POST", body: body || {} });
}

// 中文注释：
// streamTurnApiV1ChatThread(threadId, body)
// 作用：以 SSE 方式执行 chat thread turn（后端输出 meta/delta/final/error）
// 约束：仅解析 JSON data；遇到 error 事件会 throw
// 参数：
//  - threadId: string
//  - body: object
// 返回：AsyncGenerator<{ event:string, data:any }>
export async function* streamTurnApiV1ChatThread(threadId, body) {
  const res = await fetch(`/api/v1/chat/threads/${encodeThreadId(threadId)}/turn?stream=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(String(json?.message || json?.error || `${res.status} ${res.statusText}`));
  }

  for await (const evt of iterateSseEvents(res.body)) {
    const data = safeJsonParse(evt.data);
    if (!data) continue;
    if (evt.event === "error") throw new Error(String(data?.message || "上游错误"));
    yield { event: evt.event, data };
  }
}

