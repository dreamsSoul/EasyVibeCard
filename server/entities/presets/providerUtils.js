/**
 * 文件：providerUtils.js
 * 模块：server/entities/presets
 * 作用：preset 与 provider 相关的工具（模型字段选择、system 通道开关）
 * 依赖：server/shared/upstreamConfig
 * @created 2026-01-11
 * @modified 2026-01-11
 */

import { normalizeProvider as normalizeUpstreamProvider } from "../../shared/upstreamConfig.js";

/**
 * 中文注释：
 * normalizeProvider(source)
 * 作用：把输入归一化为 openai/claude/makersuite/vertexai
 * 约束：兼容别名 gemini/vertex
 * 参数：
 *  - source: any
 * 返回：'openai'|'claude'|'makersuite'|'vertexai'
 */
export function normalizeProvider(source) {
  return normalizeUpstreamProvider(source);
}

/**
 * 中文注释：
 * pickModelFromPreset(preset, provider)
 * 作用：根据 provider 从预设里选择模型字段
 * 约束：缺失返回空字符串，由调用方兜底
 * 参数：
 *  - preset: object
 *  - provider: string
 * 返回：string
 */
export function pickModelFromPreset(preset, provider) {
  if (!preset || typeof preset !== "object") return "";
  if (provider === "claude") return String(preset.claude_model || "");
  if (provider === "makersuite") return String(preset.google_model || "");
  if (provider === "vertexai") return String(preset.vertexai_model || "");
  return String(preset.openai_model || "");
}

/**
 * 中文注释：
 * pickUseSystemPromptFromPreset(preset, provider)
 * 作用：按 provider 读取“是否使用 system role”的开关
 * 约束：对齐 ST：Claude/Gemini 独立；OpenAI 默认 true
 * 参数：
 *  - preset: object
 *  - provider: string
 * 返回：boolean
 */
export function pickUseSystemPromptFromPreset(preset, provider) {
  if (!preset || typeof preset !== "object") return true;
  if (provider === "claude") return Boolean(preset.claude_use_sysprompt);
  if (provider === "makersuite" || provider === "vertexai") return Boolean(preset.use_makersuite_sysprompt);
  return true;
}

