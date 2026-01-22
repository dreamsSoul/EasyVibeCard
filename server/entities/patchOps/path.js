/**
 * 文件：path.js
 * 模块：server/entities/patchOps
 * 作用：patch 路径解析与基础判断（root/raw 辅助）
 * 依赖：无
 * @created 2026-01-07
 * @modified 2026-01-07
 */

export const PATCH_ROOT_KEYS = Object.freeze(["card", "worldbook", "regex_scripts", "tavern_helper", "raw"]);

export function parsePatchPath(path) {
  const raw = String(path || "").trim();
  if (!raw) return null;

  const parts = raw.split(".");
  const segments = [];

  for (const part of parts) {
    const m = String(part || "").match(/^([a-zA-Z0-9_]+)(?:\[(\d+)\])?$/);
    if (!m) return null;
    const key = m[1];
    const index = m[2] === undefined ? null : Number(m[2]);
    if (!key) return null;
    if (index !== null && (!Number.isFinite(index) || index < 0)) return null;
    segments.push({ key, index: index === null ? null : Math.trunc(index) });
  }

  return segments.length > 0 ? segments : null;
}

export function extractRootKey(segments) {
  return String(segments?.[0]?.key || "");
}
