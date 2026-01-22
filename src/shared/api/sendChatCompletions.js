/**
 * 文件：sendChatCompletions.js
 * 模块：shared/api
 * 作用：调用本项目后端 /api/chat/completions（单端口，避免浏览器 CORS 问题）
 * 依赖：fetch
 * @created 2025-12-28
 * @modified 2025-12-28
 */

import { iterateSseEvents } from "./sse";

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractDeltaFromJson(json) {
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

// 中文注释：
// sendChatCompletions({ upstream, request, providerOptions })
// 作用：调用本项目后端代理接口，获取 assistantText 与 debug
// 约束：后端负责跨域与上游鉴权；前端不直连 OpenAI 官方域名
// 参数：
//  - upstream: {provider?:string, baseUrl?:string, apiKey?:string}
//  - request: {model:string, messages:any[], temperature?:number, top_p?:number, max_tokens?:number, stream?:boolean}
//  - providerOptions?: {useSystemPrompt?:boolean, reasoningEffort?:string, includeReasoning?:boolean}
// 返回：Promise<{ok:boolean, assistantText?:string, error?:string, debug?:any}>
export async function sendChatCompletions({ upstream, request, providerOptions }) {
  const res = await fetch("/api/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ upstream, request, providerOptions }),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, error: json?.error || `${res.status} ${res.statusText}`, debug: json?.debug || null };
  return { ok: true, assistantText: json?.assistantText || "", debug: json?.debug || null };
}

// 中文注释：
// streamChatCompletions({ upstream, request, providerOptions })
// 作用：以 stream=true 调用后端，并把 SSE data 解析为“文本增量”流
// 约束：后端是原样透传；此处只做轻量“按 payload 形状提取文本”；
// 参数：
//  - upstream/request/providerOptions 同上；其中 request.stream 会被强制为 true
// 返回：AsyncGenerator<string>（每次 yield 一段新增文本）
export async function* streamChatCompletions({ upstream, request, providerOptions }) {
  const res = await fetch("/api/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ upstream, request: { ...request, stream: true }, providerOptions }),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => null);
    const msg = json?.error || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }

  for await (const evt of iterateSseEvents(res.body)) {
    if (evt.data === "[DONE]") return;
    const json = safeJsonParse(evt.data);
    const delta = extractDeltaFromJson(json);
    if (delta) yield delta;
  }
}
