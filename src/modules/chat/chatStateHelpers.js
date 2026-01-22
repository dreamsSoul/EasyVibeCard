/**
 * 文件：chatStateHelpers.js
 * 模块：聊天
 * 作用：Chat 组合式状态的通用工具（storage 迁移、时间格式、maskKey）
 * 依赖：shared/storage、shared/utils/time
 * @created 2026-01-11
 * @modified 2026-01-11
 */

import { nowTime, readStorageJson, writeStorageJson } from "../../shared";

export const CHAT_STORAGE_KEYS = Object.freeze({
  API_SENSITIVE: "stlike_chat_api_sensitive_v1",
  THREAD_ID: "stlike_chat_thread_id_v1",
});

export function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeText(value) {
  return String(value ?? "").trim();
}

export function toTimeLabel(iso) {
  const d = new Date(String(iso || ""));
  if (!Number.isFinite(d.getTime())) return nowTime();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function maskKey(key) {
  const k = String(key || "");
  if (!k) return "";
  if (k.length <= 8) return `${k.slice(0, 2)}****${k.slice(-2)}`;
  return `${k.slice(0, 4)}****${k.slice(-4)}`;
}

export function readThreadId() {
  return String(readStorageJson(CHAT_STORAGE_KEYS.THREAD_ID, "") || "");
}

export function writeThreadId(threadId) {
  writeStorageJson(CHAT_STORAGE_KEYS.THREAD_ID, String(threadId || ""));
}

export function readApiSensitive() {
  const v1 = readStorageJson(CHAT_STORAGE_KEYS.API_SENSITIVE, null);
  if (v1 && typeof v1 === "object") return v1;

  const v3 = readStorageJson("stlike_chat_api_v3", null);
  if (v3 && typeof v3 === "object") {
    const providers = v3.providers && typeof v3.providers === "object" ? v3.providers : {};
    return {
      rememberKey: Boolean(v3.rememberKey),
      providers: {
        openai: { key: String(providers?.openai?.key || v3.key || "") },
        claude: { key: String(providers?.claude?.key || "") },
        makersuite: { key: String(providers?.makersuite?.key || "") },
        vertexai: { key: String(providers?.vertexai?.key || "") },
      },
    };
  }

  const v2 = readStorageJson("stlike_chat_api_v2", null);
  if (v2 && typeof v2 === "object") {
    return {
      rememberKey: Boolean(v2.rememberKey),
      providers: { openai: { key: String(v2.key || "") }, claude: { key: "" }, makersuite: { key: "" }, vertexai: { key: "" } },
    };
  }

  return { rememberKey: false, providers: { openai: { key: "" }, claude: { key: "" }, makersuite: { key: "" }, vertexai: { key: "" } } };
}

export function writeApiSensitive(api) {
  writeStorageJson(CHAT_STORAGE_KEYS.API_SENSITIVE, {
    rememberKey: Boolean(api?.rememberKey),
    providers: {
      openai: { key: api?.rememberKey ? String(api?.providers?.openai?.key || "") : "" },
      claude: { key: api?.rememberKey ? String(api?.providers?.claude?.key || "") : "" },
      makersuite: { key: api?.rememberKey ? String(api?.providers?.makersuite?.key || "") : "" },
      vertexai: { key: api?.rememberKey ? String(api?.providers?.vertexai?.key || "") : "" },
    },
  });
}

