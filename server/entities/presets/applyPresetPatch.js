/**
 * 文件：applyPresetPatch.js
 * 模块：server/entities/presets
 * 作用：按白名单字段更新 preset，并做数值归一化
 * 依赖：无
 * @created 2026-01-20
 * @modified 2026-01-20
 */

const PATCH_FIELDS = Object.freeze([
  "temperature",
  "top_p",
  "top_k",
  "openai_max_tokens",
  "claude_use_sysprompt",
  "use_makersuite_sysprompt",
  "wrap_in_quotes",
  "squash_system_messages",
  "role_card_in_chat_history",
]);

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function toNumberOr(value, fallback, { min, max } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  let out = num;
  if (Number.isFinite(min)) out = Math.max(min, out);
  if (Number.isFinite(max)) out = Math.min(max, out);
  return out;
}

function toIntOr(value, fallback, { min, max } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  let out = Math.trunc(num);
  if (Number.isFinite(min)) out = Math.max(min, out);
  if (Number.isFinite(max)) out = Math.min(max, out);
  return out;
}

function normalizeBool(value, fallback) {
  if (value === undefined) return fallback;
  return Boolean(value);
}

function hasPatchField(patch) {
  return PATCH_FIELDS.some((k) => Object.prototype.hasOwnProperty.call(patch, k));
}

/**
 * 中文注释：
 * applyPresetPatch(currentPreset, patch)
 * 作用：按白名单字段合并 patch，并做必要归一化
 * 约束：仅处理 temperature/top_p/top_k/openai_max_tokens/布尔开关；不修改 prompts/prompt_order
 * 参数：
 *  - currentPreset: object（当前 preset）
 *  - patch: object（待更新字段）
 * 返回：{ preset: object, changed: boolean, hasPatch: boolean }
 */
export function applyPresetPatch(currentPreset, patch) {
  const base = isPlainObject(currentPreset) ? currentPreset : {};
  const input = isPlainObject(patch) ? patch : {};
  const hasPatch = hasPatchField(input);
  const next = { ...base };
  let changed = false;

  const setIf = (key, value) => {
    if (!Object.prototype.hasOwnProperty.call(input, key)) return;
    if (next[key] !== value) {
      next[key] = value;
      changed = true;
    }
  };

  setIf("temperature", toNumberOr(input.temperature, base.temperature, { min: 0 }));
  setIf("top_p", toNumberOr(input.top_p, base.top_p, { min: 0, max: 1 }));
  setIf("top_k", toIntOr(input.top_k, base.top_k, { min: 0 }));
  setIf("openai_max_tokens", toIntOr(input.openai_max_tokens, base.openai_max_tokens, { min: 1 }));
  setIf("claude_use_sysprompt", normalizeBool(input.claude_use_sysprompt, base.claude_use_sysprompt));
  setIf("use_makersuite_sysprompt", normalizeBool(input.use_makersuite_sysprompt, base.use_makersuite_sysprompt));
  setIf("wrap_in_quotes", normalizeBool(input.wrap_in_quotes, base.wrap_in_quotes));
  setIf("squash_system_messages", normalizeBool(input.squash_system_messages, base.squash_system_messages));
  setIf("role_card_in_chat_history", normalizeBool(input.role_card_in_chat_history, base.role_card_in_chat_history));

  return { preset: next, changed, hasPatch };
}

export function presetPatchFields() {
  return PATCH_FIELDS.slice();
}
