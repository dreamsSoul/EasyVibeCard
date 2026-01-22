/**
 * 文件：apiV1Settings.js
 * 模块：shared/api
 * 作用：Settings API（/api/v1/settings）
 * 依赖：apiV1Client
 * @created 2026-01-11
 * @modified 2026-01-11
 */

import { apiV1FetchJson } from "./apiV1Client";

export async function getApiV1Settings() {
  return await apiV1FetchJson("/api/v1/settings");
}

export async function patchApiV1Settings(patch) {
  return await apiV1FetchJson("/api/v1/settings", { method: "PATCH", body: patch || {} });
}

