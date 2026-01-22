/**
 * 文件：upstreamLlmStreamDelta.js
 * 模块：server/adapters/gateways
 * 作用：上游 SSE payload 的文本增量提取（OpenAI/Claude/Gemini 兼容）
 * 依赖：无
 * @created 2026-01-11
 * @modified 2026-01-11
 */

export function safeJsonParse(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
}

export function extractDeltaFromJson(json) {
  if (!json || typeof json !== "object") return "";

  // OpenAI-likes
  if (Array.isArray(json.choices) && json.choices.length > 0) {
    const c0 = json.choices[0] || {};
    const delta = c0.delta || {};
    if (typeof delta.content === "string") return delta.content;
    if (typeof delta.text === "string") return delta.text;
    if (typeof c0.text === "string") return c0.text;
    if (typeof c0?.message?.content === "string") return c0.message.content;
  }

  // Claude (Anthropic SSE chunks often have json.delta.text)
  if (typeof json?.delta?.text === "string") return json.delta.text;

  // Gemini (MakerSuite / Vertex) SSE chunks often have candidates[0].content.parts[].text
  if (Array.isArray(json.candidates) && json.candidates.length > 0) {
    const c0 = json.candidates[0] || {};
    if (typeof c0.output === "string") return c0.output;
    if (typeof c0.content === "string") return c0.content;
    const parts = c0?.content?.parts;
    if (Array.isArray(parts)) {
      return parts
        .map((p) => (typeof p?.text === "string" ? p.text : ""))
        .filter(Boolean)
        .join("\n\n");
    }
  }

  return "";
}

