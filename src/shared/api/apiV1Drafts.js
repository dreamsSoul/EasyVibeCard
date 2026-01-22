/**
 * 文件：apiV1Drafts.js
 * 模块：shared/api
 * 作用：Draft API（/api/v1/drafts：create/get/apply/apply-items/rollback/chat）
 * 依赖：apiV1Client
 * @created 2026-01-11
 * @modified 2026-01-20
 */

import { apiV1FetchJson } from "./apiV1Client";

function encodeDraftId(draftId) {
  return encodeURIComponent(String(draftId || ""));
}

export async function createApiV1Draft(body) {
  return await apiV1FetchJson("/api/v1/drafts", { method: "POST", body: body || {} });
}

export async function getApiV1Draft(draftId) {
  return await apiV1FetchJson(`/api/v1/drafts/${encodeDraftId(draftId)}`);
}

export async function applyApiV1DraftPatch(draftId, body) {
  return await apiV1FetchJson(`/api/v1/drafts/${encodeDraftId(draftId)}/apply`, { method: "POST", body: body || {} });
}

export async function applyApiV1DraftItems(draftId, body) {
  return await apiV1FetchJson(`/api/v1/drafts/${encodeDraftId(draftId)}/apply-items`, { method: "POST", body: body || {} });
}

export async function rollbackApiV1Draft(draftId, body) {
  return await apiV1FetchJson(`/api/v1/drafts/${encodeDraftId(draftId)}/rollback`, { method: "POST", body: body || {} });
}

export async function resetApiV1Draft(draftId, body) {
  return await apiV1FetchJson(`/api/v1/drafts/${encodeDraftId(draftId)}/reset`, { method: "POST", body: body || {} });
}

export async function getApiV1DraftChat(draftId, { beforeSeq, limit, view } = {}) {
  const q = new URLSearchParams();
  if (beforeSeq !== undefined && beforeSeq !== null && beforeSeq !== "") q.set("beforeSeq", String(beforeSeq));
  if (limit !== undefined && limit !== null && limit !== "") q.set("limit", String(limit));
  if (view !== undefined && view !== null && view !== "") q.set("view", String(view));
  const suffix = q.toString() ? `?${q}` : "";
  return await apiV1FetchJson(`/api/v1/drafts/${encodeDraftId(draftId)}/chat${suffix}`);
}
