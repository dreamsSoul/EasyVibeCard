/**
 * 文件：providerUtils.js
 * 模块：shared/llm
 * 作用：provider 归一化、模型字段选择、providerOptions 组装（供 chat/vcard 等模块复用）
 * 依赖：无
 * @created 2025-12-28
 * @modified 2026-01-01
 */

// 中文注释：
// normalizeProvider(source)
// 作用：把预设/UI 输入的 provider 归一化为 openai/claude/makersuite/vertexai
// 约束：兼容别名 gemini/vertex
// 参数：
//  - source: any（预设 chat_completion_source 或 UI 选择值）
// 返回：'openai'|'claude'|'makersuite'|'vertexai'
export function normalizeProvider(source) {
  const raw = String(source || "").trim().toLowerCase();
  if (raw === "claude") return "claude";
  if (raw === "makersuite" || raw === "gemini") return "makersuite";
  if (raw === "vertexai" || raw === "vertex") return "vertexai";
  return "openai";
}

// 中文注释：
// pickModelFromPreset(preset, provider)
// 作用：根据 provider 从预设里选取对应的模型字段
// 约束：字段缺失时返回空字符串，由调用方兜底默认
// 参数：
//  - preset: object（对话补齐预设）
//  - provider: string（openai/claude/makersuite/vertexai）
// 返回：string
export function pickModelFromPreset(preset, provider) {
  if (!preset || typeof preset !== "object") return "";
  if (provider === "claude") return String(preset.claude_model || "");
  if (provider === "makersuite") return String(preset.google_model || "");
  if (provider === "vertexai") return String(preset.vertexai_model || "");
  return String(preset.openai_model || "");
}

// 中文注释：
// pickUseSystemPromptFromPreset(preset, provider)
// 作用：按 provider 从预设里取“是否使用 system 通道”的开关
// 约束：对齐 ST 语义：Claude/Gemini 各自独立；OpenAI 默认使用 system
// 参数：
//  - preset: object
//  - provider: string
// 返回：boolean
export function pickUseSystemPromptFromPreset(preset, provider) {
  if (!preset || typeof preset !== "object") return true;
  if (provider === "claude") return Boolean(preset.claude_use_sysprompt);
  if (provider === "makersuite" || provider === "vertexai") return Boolean(preset.use_makersuite_sysprompt);
  return true;
}

// 中文注释：
// buildProviderOptions({ preset, provider, ui })
// 作用：把“预设开关 + UI 推理设置”组装为后端可理解的 providerOptions
// 约束：useSystemPrompt 按 provider 取值；推理参数仅对部分 provider/模型生效
// 参数：
//  - preset: object（对话补齐预设）
//  - provider: string（openai/claude/makersuite/vertexai）
//  - ui: object（reasoningEffort/includeReasoning）
// 返回：{useSystemPrompt:boolean, reasoningEffort:string, includeReasoning:boolean}
export function buildProviderOptions({ preset, provider, ui }) {
  return {
    useSystemPrompt: pickUseSystemPromptFromPreset(preset, provider),
    reasoningEffort: String(ui?.reasoningEffort || "auto"),
    includeReasoning: Boolean(ui?.includeReasoning),
  };
}

