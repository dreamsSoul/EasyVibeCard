/**
 * 文件：normalizeImportedPreset.js
 * 模块：shared/preset
 * 作用：导入并归一化 SillyTavern 对话补齐预设（Chat Completion preset）
 * 依赖：无
 * @created 2025-12-28
 * @modified 2026-01-03
 */

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

export const BUILTIN_DEFAULT_PRESET = Object.freeze({
  name: "默认（内置）",
  chat_completion_source: "openai",
  openai_model: "gpt-4o-mini",
  claude_model: "claude-sonnet-4-5",
  google_model: "gemini-2.5-pro",
  vertexai_model: "gemini-2.5-pro",
  new_chat_prompt: "[Start a new Chat]",
  new_group_chat_prompt: "[Start a new group chat. Group members: {{group}}]",
  new_example_chat_prompt: "[Example Chat]",
  temperature: 1,
  top_p: 1,
  top_k: 0,
  openai_max_tokens: 300,
  claude_use_sysprompt: false,
  use_makersuite_sysprompt: true,
  wi_format: "{0}",
  scenario_format: "{{scenario}}",
  personality_format: "{{personality}}",
  wrap_in_quotes: false,
  squash_system_messages: false,
  role_card_in_chat_history: true,
  prompts: [
    {
      name: "Main Prompt",
      system_prompt: true,
      role: "system",
      content: "Write {{char}}'s next reply in a fictional chat between {{charIfNotGroup}} and {{user}}.",
      identifier: "main",
    },
    { name: "Auxiliary Prompt", system_prompt: true, role: "system", content: "", identifier: "nsfw" },
    { name: "Chat Examples", system_prompt: true, marker: true, identifier: "dialogueExamples" },
    { name: "Post-History Instructions", system_prompt: true, role: "system", content: "", identifier: "jailbreak" },
    { name: "Chat History", system_prompt: true, marker: true, identifier: "chatHistory" },
    { name: "World Info (after)", system_prompt: true, marker: true, identifier: "worldInfoAfter" },
    { name: "World Info (before)", system_prompt: true, marker: true, identifier: "worldInfoBefore" },
    {
      name: "Enhance Definitions",
      system_prompt: true,
      role: "system",
      marker: false,
      content:
        "If you have more knowledge of {{char}}, add to the character's lore and personality to enhance them but keep the Character Sheet's definitions absolute.",
      identifier: "enhanceDefinitions",
    },
    { name: "Char Description", system_prompt: true, marker: true, identifier: "charDescription" },
    { name: "Char Personality", system_prompt: true, marker: true, identifier: "charPersonality" },
    { name: "Scenario", system_prompt: true, marker: true, identifier: "scenario" },
    { name: "Persona Description", system_prompt: true, marker: true, identifier: "personaDescription" },
  ],
  prompt_order: [
    {
      character_id: 100001,
      order: [
        { identifier: "main", enabled: true },
        { identifier: "worldInfoBefore", enabled: true },
        { identifier: "personaDescription", enabled: true },
        { identifier: "charDescription", enabled: true },
        { identifier: "charPersonality", enabled: true },
        { identifier: "scenario", enabled: true },
        { identifier: "enhanceDefinitions", enabled: false },
        { identifier: "nsfw", enabled: true },
        { identifier: "worldInfoAfter", enabled: true },
        { identifier: "dialogueExamples", enabled: true },
        { identifier: "chatHistory", enabled: true },
        { identifier: "jailbreak", enabled: true },
      ],
    },
  ],
});

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

// 中文注释：
// normalizeImportedPreset(raw, fileName)
// 作用：把导入 JSON 归一化为“对话补齐预设”形状（补齐 prompts/prompt_order 关键项）
// 约束：以内置默认预设为基底；按 identifier 合并；缺失项会自动补齐
// 参数：
//  - raw: any（导入 JSON 对象，可为 {data:{...}} 包装）
//  - fileName: string（用于推导预设名）
// 返回：object（可直接用于本项目聊天）
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
