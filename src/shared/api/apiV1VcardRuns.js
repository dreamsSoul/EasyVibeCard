/**
 * 文件：apiV1VcardRuns.js
 * 模块：shared/api
 * 作用：VCard Run API（/api/v1/vcard/runs：start/status/events/result/cancel）
 * 依赖：apiV1Client、shared/api/sse
 * @created 2026-01-14
 * @modified 2026-01-14
 */

import { apiV1FetchJson } from "./apiV1Client";
import { iterateSseEvents } from "./sse";

function safeJsonParse(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
}

export async function startApiV1VcardRun(body) {
  return await apiV1FetchJson("/api/v1/vcard/runs", { method: "POST", body: body || {} });
}

export async function getApiV1VcardRun(runId) {
  return await apiV1FetchJson(`/api/v1/vcard/runs/${encodeURIComponent(String(runId || ""))}`);
}

export async function getApiV1VcardRunResult(runId) {
  return await apiV1FetchJson(`/api/v1/vcard/runs/${encodeURIComponent(String(runId || ""))}/result`);
}

export async function cancelApiV1VcardRun(runId) {
  return await apiV1FetchJson(`/api/v1/vcard/runs/${encodeURIComponent(String(runId || ""))}/cancel`, { method: "POST", body: {} });
}

// 中文注释：
// streamApiV1VcardRunEvents({ runId, lastEventId, signal })
// 作用：订阅 Run events（SSE）；支持 Last-Event-ID 续播
// 约束：仅解析 JSON data；遇到 error 事件会 throw
// 参数：
//  - runId: string
//  - lastEventId?: string|number
//  - signal?: AbortSignal
// 返回：AsyncGenerator<{ event:string, data:any, id?:string }>
export async function* streamApiV1VcardRunEvents({ runId, lastEventId, signal }) {
  const id = String(runId || "").trim();
  if (!id) throw new Error("runId 不能为空。");

  const headers = {};
  if (lastEventId !== null && lastEventId !== undefined && String(lastEventId).trim()) {
    headers["Last-Event-ID"] = String(lastEventId).trim();
  }

  const res = await fetch(`/api/v1/vcard/runs/${encodeURIComponent(id)}/events`, { method: "GET", headers, signal });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(String(json?.message || json?.error || `${res.status} ${res.statusText}`));
  }

  for await (const evt of iterateSseEvents(res.body)) {
    const data = safeJsonParse(evt.data);
    if (!data) continue;
    if (evt.event === "error") {
      const err = new Error(String(data?.message || "VCard Run 失败"));
      err.code = data?.code;
      err.details = data?.details;
      err.requestId = data?.requestId;
      err.draftId = data?.draftId;
      err.runId = data?.runId;
      err.eventId = evt.id;
      throw err;
    }
    yield { event: evt.event, data, id: evt.id };
  }
}

