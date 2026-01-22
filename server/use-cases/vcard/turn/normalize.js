/**
 * 文件：normalize.js
 * 模块：server/use-cases/vcard/turn
 * 作用：VCard Turn 的输入归一化与安全校验（requestId/read.path）
 * 依赖：无
 * @created 2026-01-07
 * @modified 2026-01-07
 */

import crypto from "node:crypto";

export function nowIso() {
  return new Date().toISOString();
}

export function normalizeText(value) {
  return String(value ?? "").trim();
}

export function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeProviderOptions(value) {
  const opt = isPlainObject(value) ? value : {};
  return {
    useSystemPrompt: opt.useSystemPrompt === undefined ? undefined : Boolean(opt.useSystemPrompt),
    reasoningEffort: opt.reasoningEffort === undefined ? undefined : normalizeText(opt.reasoningEffort || "auto") || "auto",
    includeReasoning: opt.includeReasoning === undefined ? undefined : Boolean(opt.includeReasoning),
    upstreamStream: opt.upstreamStream === undefined ? undefined : Boolean(opt.upstreamStream),
  };
}

export function normalizeRequestId(value) {
  const s = normalizeText(value);
  return s || crypto.randomUUID();
}

export function validateReadPath(path) {
  const raw = normalizeText(path).replace(/\\/g, "/");
  if (!raw) return { ok: false, error: "read.path 为空。" };
  if (raw.startsWith("/") || raw.startsWith("\\")) return { ok: false, error: "read.path 不允许绝对路径。" };
  if (/^[a-zA-Z]:/.test(raw)) return { ok: false, error: "read.path 不允许盘符路径。" };
  if (raw.includes("..")) return { ok: false, error: "read.path 不允许包含 '..'。" };
  if (raw.includes("//")) return { ok: false, error: "read.path 不允许空段（a//b）。" };
  return { ok: true };
}
