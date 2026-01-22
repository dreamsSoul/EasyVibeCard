/**
 * 文件：apiV1Presets.js
 * 模块：shared/api
 * 作用：Presets API（/api/v1/presets）
 * 依赖：apiV1Client
 * @created 2026-01-11
 * @modified 2026-01-20
 */

import { apiV1FetchJson } from "./apiV1Client";

function encodePresetName(name) {
  return encodeURIComponent(String(name || ""));
}

export async function listApiV1Presets() {
  return await apiV1FetchJson("/api/v1/presets");
}

export async function getApiV1PresetByName(name) {
  return await apiV1FetchJson(`/api/v1/presets/${encodePresetName(name)}`);
}

export async function importApiV1Preset({ fileName, rawPreset }) {
  return await apiV1FetchJson("/api/v1/presets/import", { method: "POST", body: { fileName, rawPreset } });
}

export async function deleteApiV1PresetByName(name) {
  return await apiV1FetchJson(`/api/v1/presets/${encodePresetName(name)}`, { method: "DELETE" });
}

export async function patchApiV1PresetByName(name, patch) {
  return await apiV1FetchJson(`/api/v1/presets/${encodePresetName(name)}`, { method: "PATCH", body: patch || {} });
}
