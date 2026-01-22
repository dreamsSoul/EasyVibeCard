/**
 * 文件：normalize.js
 * 模块：server/use-cases/vcard/runs
 * 作用：Run 输入归一化（runOptions/requestId）
 * 依赖：无
 * @created 2026-01-08
 * @modified 2026-01-08
 */

function toIntOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

export function normalizeText(value) {
  return String(value ?? "").trim();
}

function clampInt(value, { min, max, fallback }) {
  const n = toIntOrNull(value);
  if (n === null) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

export function normalizeRunOptions(raw) {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    maxTurns: clampInt(obj.maxTurns, { min: 1, max: 200, fallback: 20 }),
    maxReadRounds: clampInt(obj.maxReadRounds, { min: 1, max: 10, fallback: 10 }),
    noChangeTurns: clampInt(obj.noChangeTurns, { min: 1, max: 10, fallback: 2 }),
    planNoProgressTurns: clampInt(obj.planNoProgressTurns, { min: 1, max: 10, fallback: 2 }),
  };
}

export function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

export function pickModelFromInput(input) {
  const preset = isPlainObject(input?.preset) ? input.preset : {};
  return normalizeText(input?.model || preset?.model || preset?.openai_model || "");
}
