/**
 * 文件：apiV1VcardPending.js
 * 模块：shared/api
 * 作用：VCard Pending API（/api/v1/vcard/pending：查询 + plan/patch 审批动作）
 * 依赖：apiV1Client
 * @created 2026-01-17
 * @modified 2026-01-17
 */

import { apiV1FetchJson } from "./apiV1Client";

export async function getApiV1VcardPending(draftId) {
  const id = String(draftId || "").trim();
  return await apiV1FetchJson(`/api/v1/vcard/pending?draftId=${encodeURIComponent(id)}`);
}

export async function approveApiV1VcardPendingPlan(body) {
  return await apiV1FetchJson("/api/v1/vcard/pending/plan/approve", { method: "POST", body: body || {} });
}

export async function rejectApiV1VcardPendingPlan(body) {
  return await apiV1FetchJson("/api/v1/vcard/pending/plan/reject", { method: "POST", body: body || {} });
}

export async function acceptApiV1VcardPendingPatch(body) {
  return await apiV1FetchJson("/api/v1/vcard/pending/patch/accept", { method: "POST", body: body || {} });
}

export async function rejectApiV1VcardPendingPatch(body) {
  return await apiV1FetchJson("/api/v1/vcard/pending/patch/reject", { method: "POST", body: body || {} });
}

