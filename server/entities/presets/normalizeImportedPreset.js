/**
 * 文件：normalizeImportedPreset.js
 * 模块：server/entities/presets
 * 作用：导入并归一化 SillyTavern 对话补齐预设（Chat Completion preset）
 * 依赖：builtinDefaultPreset
 * @created 2026-01-11
 * @modified 2026-01-11
 */

import { BUILTIN_DEFAULT_PRESET } from "./builtinDefaultPreset.js";

const REQUIRED_IDENTIFIERS = Object.freeze([
  "main",
  "worldInfoBefore",
  "personaDescription",
  "charDescription",
  "charPersonality",
  "scenario",
  "enhanceDefinitions",
  "nsfw",
  "worldInfoAfter",
  "dialogueExamples",
  "chatHistory",
  "jailbreak",
]);

function stripJsonExt(fileName) {
  return String(fileName || "preset").replace(/\.json$/i, "");
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function toNumberOr(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toIntOr(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.trunc(num));
}

function pickOrderEntry(promptOrders, characterId) {
  const list = Array.isArray(promptOrders) ? promptOrders : [];
  return list.find((x) => x && typeof x === "object" && Number(x.character_id) === Number(characterId));
}

function ensureRequiredOrderEntries(promptOrders) {
  const entry = pickOrderEntry(promptOrders, 100001);
  if (!entry || !Array.isArray(entry.order)) return promptOrders;

  const has = new Set(entry.order.filter((x) => x && typeof x.identifier === "string").map((x) => x.identifier));
  for (const id of REQUIRED_IDENTIFIERS) {
    if (has.has(id)) continue;
    const defaultEnabled = Boolean(BUILTIN_DEFAULT_PRESET.prompt_order?.[0]?.order?.find((x) => x.identifier === id)?.enabled ?? true);
    entry.order.push({ identifier: id, enabled: defaultEnabled });
  }
  return promptOrders;
}

function mergePromptOrder(baseOrders, importedOrders) {
  const baseList = Array.isArray(baseOrders) ? baseOrders : [];
  const importedList = Array.isArray(importedOrders) ? importedOrders : null;
  if (!importedList || importedList.length === 0) return cloneJson(baseList);

  const result = cloneJson(importedList);
  const imported100001 = pickOrderEntry(result, 100001);
  if (imported100001 && Array.isArray(imported100001.order)) return ensureRequiredOrderEntries(result);

  const base100001 = pickOrderEntry(baseList, 100001) || pickOrderEntry(baseList, 100000) || baseList[0];
  const fallbackImported = pickOrderEntry(result, 100000) || result[0];
  const order = cloneJson(Array.isArray(fallbackImported?.order) ? fallbackImported.order : base100001?.order || []);
  result.push({ character_id: 100001, order });
  return ensureRequiredOrderEntries(result);
}

function ensureRequiredPrompts(prompts) {
  const list = Array.isArray(prompts) ? prompts : [];
  const byId = new Set(list.filter((p) => p && typeof p.identifier === "string").map((p) => p.identifier));
  for (const id of REQUIRED_IDENTIFIERS) {
    if (byId.has(id)) continue;
    const fallback = BUILTIN_DEFAULT_PRESET.prompts.find((p) => p.identifier === id);
    if (fallback) list.push(cloneJson(fallback));
  }
  return list;
}

function mergePrompts(basePrompts, importedPrompts) {
  const baseList = Array.isArray(basePrompts) ? basePrompts : [];
  const importedList = Array.isArray(importedPrompts) ? importedPrompts : null;
  if (!importedList || importedList.length === 0) return cloneJson(baseList);

  const mergedById = new Map();
  for (const p of baseList) if (p?.identifier) mergedById.set(p.identifier, cloneJson(p));
  for (const p of importedList) {
    if (!p || typeof p !== "object" || typeof p.identifier !== "string") continue;
    mergedById.set(p.identifier, { ...(mergedById.get(p.identifier) || {}), ...cloneJson(p) });
  }

  const result = [];
  for (const p of baseList) {
    if (!p?.identifier) continue;
    result.push(mergedById.get(p.identifier));
    mergedById.delete(p.identifier);
  }
  for (const [_, p] of mergedById) result.push(p);
  return ensureRequiredPrompts(result);
}

/**
 * 中文注释：
 * normalizeImportedPreset(raw, fileName)
 * 作用：把导入 JSON 归一化为“对话补齐预设”形状（补齐 prompts/prompt_order 关键项）
 * 约束：以内置默认预设为基底；按 identifier 合并；缺失项会自动补齐
 * 参数：
 *  - raw: any（导入 JSON 对象，可为 {data:{...}} 包装）
 *  - fileName: string（用于推导预设名）
 * 返回：object（可直接用于本项目聊天）
 */
export function normalizeImportedPreset(raw, fileName) {
  const nameFromFile = stripJsonExt(fileName);
  const data = raw && typeof raw === "object" && raw.data && typeof raw.data === "object" ? raw.data : raw;
  const base = cloneJson(BUILTIN_DEFAULT_PRESET);
  const merged = { ...base, ...(data || {}) };

  merged.name = (nameFromFile || merged.name || "Imported").trim();
  merged.prompts = mergePrompts(base.prompts, data?.prompts);
  merged.prompt_order = mergePromptOrder(base.prompt_order, data?.prompt_order);

  merged.temperature = toNumberOr(merged.temperature, base.temperature);
  merged.top_p = toNumberOr(merged.top_p, base.top_p);
  merged.top_k = toIntOr(merged.top_k, base.top_k);
  merged.openai_max_tokens = toIntOr(merged.openai_max_tokens, base.openai_max_tokens);
  merged.claude_use_sysprompt = Boolean(merged.claude_use_sysprompt);
  merged.use_makersuite_sysprompt = Boolean(merged.use_makersuite_sysprompt);
  merged.wrap_in_quotes = Boolean(merged.wrap_in_quotes);
  merged.squash_system_messages = Boolean(merged.squash_system_messages);
  merged.role_card_in_chat_history = merged.role_card_in_chat_history === undefined ? base.role_card_in_chat_history : Boolean(merged.role_card_in_chat_history);
  merged.openai_model = String(merged.openai_model || base.openai_model);
  merged.claude_model = String(merged.claude_model || base.claude_model);
  merged.google_model = String(merged.google_model || base.google_model);
  merged.vertexai_model = String(merged.vertexai_model || base.vertexai_model);
  merged.wi_format = String(merged.wi_format || base.wi_format);
  merged.scenario_format = String(merged.scenario_format || base.scenario_format);
  merged.personality_format = String(merged.personality_format || base.personality_format);

  return merged;
}

