/**
 * 文件：utils.js
 * 模块：server/entities/vcard/readProtocol
 * 作用：Read 协议通用工具（plainObject/limit/path 处理）
 * 依赖：无
 * @created 2026-01-08
 * @modified 2026-01-08
 */

export function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function toIntOr(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

export function clampInt(value, { min, max, fallback }) {
  const n = toIntOr(value, fallback);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

export function toStringOrEmpty(value) {
  return String(value ?? "");
}

export function normalizeReadPath(value) {
  return String(value ?? "").trim();
}

export function normalizePathSegment(value) {
  return String(value ?? "").trim().replace(/[\\/]/g, "／");
}

export function parseIndexSegment(segment) {
  const s = String(segment ?? "").trim();
  if (!s) return null;
  const bracket = s.match(/^\[(\d+)\]$/);
  if (bracket) return Number(bracket[1]);
  if (/^\d+$/.test(s)) return Number(s);
  return null;
}

