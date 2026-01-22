/**
 * 文件：buildMessages.js
 * 模块：shared/messages
 * 作用：按 SillyTavern prompts/prompt_order 组装 Chat Completions messages[]
 * 依赖：无
 * @created 2025-12-28
 * @modified 2026-01-03
 */

function pickOrderEntry(promptOrders, characterId) {
  const list = Array.isArray(promptOrders) ? promptOrders : [];
  return list.find((x) => x && typeof x === "object" && Number(x.character_id) === Number(characterId));
}

function renderTemplate(text, vars) {
  return String(text || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => String(vars?.[key] ?? ""));
}

function applyWiFormat(format, value) {
  const fmt = String(format || "{0}");
  return fmt.includes("{0}") ? fmt.replaceAll("{0}", String(value || "")) : String(value || "");
}

function squashSystemMessages(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const out = [];
  for (const m of list) {
    if (!m || typeof m.role !== "string") continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === "system" && m.role === "system") {
      prev.content = `${prev.content}\n\n${m.content}`.trim();
      continue;
    }
    out.push({ role: m.role, content: String(m.content || "") });
  }
  return out;
}

function resolvePromptRole(prompt) {
  const role = String(prompt?.role || "").trim();
  if (role === "system" || role === "user" || role === "assistant") return role;
  return prompt?.system_prompt ? "system" : "user";
}

const FORCED_NON_MARKER_IDENTIFIERS = new Set(["main", "nsfw", "jailbreak", "enhanceDefinitions"]);
const FORCED_MARKER_IDENTIFIERS = new Set([
  "chatHistory",
  "worldInfoBefore",
  "worldInfoAfter",
  "dialogueExamples",
  "personaDescription",
  "charDescription",
  "charPersonality",
  "scenario",
]);

function isMarkerPrompt(identifier, prompt) {
  if (FORCED_NON_MARKER_IDENTIFIERS.has(identifier)) return false;
  if (FORCED_MARKER_IDENTIFIERS.has(identifier)) return true;
  return Boolean(prompt?.marker);
}

function markerToMessages(identifier, { preset, ctx, chat, vars }) {
  const sys = (text) => [{ role: "system", content: renderTemplate(text, vars).trim() }].filter((m) => m.content);

  switch (identifier) {
    case "chatHistory":
      return [
        ...(() => {
          const newChatPrompt = String(preset?.new_chat_prompt || "").trim();
          return newChatPrompt ? sys(newChatPrompt) : [];
        })(),
        ...(Array.isArray(chat) ? chat : [])
          .filter((m) => m && (m.role === "user" || m.role === "assistant") && String(m.content || "").trim())
          .map((m) => {
            const content = String(m.content || "").trim();
            const wrapped = m.role === "user" && Boolean(preset?.wrap_in_quotes) && !m?.noQuote ? `"${content}"` : content;
            return { role: m.role, content: wrapped };
          }),
      ];
    case "worldInfoBefore":
      return ctx?.worldInfoBefore ? sys(applyWiFormat(preset?.wi_format, ctx.worldInfoBefore)) : [];
    case "worldInfoAfter":
      return ctx?.worldInfoAfter ? sys(applyWiFormat(preset?.wi_format, ctx.worldInfoAfter)) : [];
    case "dialogueExamples":
      return ctx?.dialogueExamples
        ? [
            ...(() => {
              const newExampleChatPrompt = String(preset?.new_example_chat_prompt || "").trim();
              return newExampleChatPrompt ? sys(newExampleChatPrompt) : [];
            })(),
            ...sys(ctx.dialogueExamples),
          ]
        : [];
    case "personaDescription":
      return ctx?.personaDescription ? sys(ctx.personaDescription) : [];
    case "charDescription":
      return ctx?.charDescription ? sys(ctx.charDescription) : [];
    case "charPersonality": {
      if (!ctx?.charPersonality) return [];
      const fmt = String(preset?.personality_format || "{{personality}}");
      return sys(renderTemplate(fmt, { ...vars, personality: String(ctx.charPersonality) }));
    }
    case "scenario": {
      if (!ctx?.scenario) return [];
      const fmt = String(preset?.scenario_format || "{{scenario}}");
      return sys(renderTemplate(fmt, { ...vars, scenario: String(ctx.scenario) }));
    }
    default:
      return [];
  }
}

// 中文注释：
// buildMessages({ preset, ctx, chat, userInput, useSystemPrompt })
// 作用：按 SillyTavern prompts/prompt_order 生成 messages[]（并支持 marker 注入）
// 约束：只实现本项目需要的 marker；不做 token 截断；非流式请求
// 参数：
//  - preset: object（对话补齐预设）
//  - ctx: object（上下文：user/char/世界书片段等）
//  - chat: {role:'user'|'assistant',content:string}[]（历史）
//  - userInput: string（本次用户输入）
//  - useSystemPrompt: boolean（是否保留 system role）
// 返回：{role:'system'|'user'|'assistant',content:string}[]
export function buildMessages({ preset, ctx, chat, userInput, useSystemPrompt }) {
  const orderEntry = pickOrderEntry(preset?.prompt_order, 100001) || pickOrderEntry(preset?.prompt_order, 100000);
  const order = Array.isArray(orderEntry?.order) ? orderEntry.order : [];

  const prompts = Array.isArray(preset?.prompts) ? preset.prompts : [];
  const promptById = new Map(prompts.filter((p) => p && typeof p.identifier === "string").map((p) => [p.identifier, p]));

  const roleCardInChatHistory = preset?.role_card_in_chat_history === undefined ? true : Boolean(preset?.role_card_in_chat_history);
  const hasChatHistoryMarker = order.some((x) => x?.identifier === "chatHistory" && (x?.enabled === undefined ? true : Boolean(x.enabled)) && promptById.has("chatHistory"));
  const mergeRoleCardIntoChatHistory = roleCardInChatHistory && hasChatHistoryMarker;
  const ROLE_CARD_MARKERS = new Set(["personaDescription", "charDescription", "charPersonality", "scenario"]);

  const vars = {
    user: String(ctx?.user || "User"),
    char: String(ctx?.char || "Assistant"),
    group: String(ctx?.char || "Assistant"),
    groupNotMuted: String(ctx?.char || "Assistant"),
    charIfNotGroup: String(ctx?.char || "Assistant"),
    notChar: String(ctx?.user || "User"),
    scenario: String(ctx?.scenario || ""),
    personality: String(ctx?.charPersonality || ""),
    description: String(ctx?.charDescription || ""),
    persona: String(ctx?.personaDescription || ""),
    mesExamples: String(ctx?.dialogueExamples || ""),
  };

  const roleCardText = (() => {
    if (!mergeRoleCardIntoChatHistory) return "";
    const parts = [];

    const persona = String(ctx?.personaDescription || "").trim();
    if (persona) parts.push(persona);

    const desc = String(ctx?.charDescription || "").trim();
    if (desc) parts.push(desc);

    const personality = String(ctx?.charPersonality || "").trim();
    if (personality) {
      const fmt = String(preset?.personality_format || "{{personality}}");
      parts.push(renderTemplate(fmt, { ...vars, personality }));
    }

    const scenario = String(ctx?.scenario || "").trim();
    if (scenario) {
      const fmt = String(preset?.scenario_format || "{{scenario}}");
      parts.push(renderTemplate(fmt, { ...vars, scenario }));
    }

    return parts.map((x) => String(x || "").trim()).filter(Boolean).join("\n\n");
  })();

  const inputText = String(userInput || "").trim();
  const history = (() => {
    const list = Array.isArray(chat) ? chat.slice() : [];
    if (!inputText) return list;
    const last = list[list.length - 1];
    if (last?.role === "user" && String(last.content || "").trim() === inputText) return list;
    return [...list, { role: "user", content: inputText }];
  })();

  const messages = [];
  for (const item of order) {
    if (!item || typeof item.identifier !== "string") continue;
    const identifier = item.identifier;
    const enabled = identifier === "main" ? true : item.enabled === undefined ? true : Boolean(item.enabled);
    if (!enabled) continue;
    const p = promptById.get(identifier);
    if (!p) continue;

    if (mergeRoleCardIntoChatHistory && ROLE_CARD_MARKERS.has(identifier)) continue;

    if (isMarkerPrompt(identifier, p)) {
      if (mergeRoleCardIntoChatHistory && identifier === "chatHistory" && roleCardText) {
        const injectedHistory = [{ role: "user", content: roleCardText, noQuote: true }, ...history];
        messages.push(...markerToMessages(identifier, { preset, ctx, chat: injectedHistory, vars }));
      } else {
        messages.push(...markerToMessages(identifier, { preset, ctx, chat: history, vars }));
      }
      continue;
    }

    const role = resolvePromptRole(p);
    const content = renderTemplate(String(p.content || ""), vars).trim();
    if (content) messages.push({ role, content });
  }

  // 兜底：如果预设没启用 chatHistory（或缺失 marker），仍保证本次 userInput 会进入 messages
  if (inputText) {
    const expected = Boolean(preset?.wrap_in_quotes) ? `"${inputText}"` : inputText;
    const has = messages.some((m) => m?.role === "user" && String(m.content || "").trim() === expected);
    if (!has) messages.push({ role: "user", content: expected });
  }

  const downgraded = useSystemPrompt ? messages : messages.map((m) => (m.role === "system" ? { ...m, role: "user" } : m));
  return preset?.squash_system_messages ? squashSystemMessages(downgraded) : downgraded;
}
