/**
 * 文件：builtinDefaultPreset.js
 * 模块：server/entities/presets
 * 作用：内置默认 ST-like Chat Completion 预设（服务端版本）
 * 依赖：无
 * @created 2026-01-11
 * @modified 2026-01-11
 */

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

