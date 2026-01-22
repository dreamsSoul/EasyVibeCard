/**
 * 文件：apiV1Vcard.js
 * 模块：shared/api
 * 作用：VCard API（/api/v1/vcard/turn：非流式 + SSE）
 * 依赖：apiV1Client、shared/api/sse
 * @created 2026-01-11
 * @modified 2026-01-11
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

export async function turnApiV1Vcard(body) {
  return await apiV1FetchJson("/api/v1/vcard/turn", { method: "POST", body: body || {} });
}

// 中文注释：
// streamTurnApiV1Vcard(body)
// 作用：以 SSE 方式执行 vcard turn（后端输出 meta/read_request/read_result/delta/patch_ops/applied/final/error）
// 约束：仅解析 JSON data；遇到 error 事件会 throw
// 参数：
//  - body: object
//  - options?: { signal?: AbortSignal }
// 返回：AsyncGenerator<{ event:string, data:any, id?:string }>
export async function* streamTurnApiV1Vcard(body, options = {}) {
  const res = await fetch("/api/v1/vcard/turn?stream=true", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
    signal: options?.signal,
  });

  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new Error(String(json?.message || json?.error || `${res.status} ${res.statusText}`));
  }

  for await (const evt of iterateSseEvents(res.body)) {
    const data = safeJsonParse(evt.data);
    if (!data) continue;
    if (evt.event === "error") {
      const err = new Error(String(data?.message || "VCard Turn 失败"));
      err.code = data?.code;
      err.details = data?.details;
      err.requestId = data?.requestId;
      err.draftId = data?.draftId;
      err.eventId = evt.id;
      throw err;
    }
    yield { event: evt.event, data, id: evt.id };
  }
}
