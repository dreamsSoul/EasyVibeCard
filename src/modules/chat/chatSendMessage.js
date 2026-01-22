/**
 * 文件：chatSendMessage.js
 * 模块：聊天
 * 作用：封装 Chat 单轮发送（/api/v1/chat/threads/:id/turn，支持 SSE）
 * 依赖：shared/apiV1/chatThreads、shared/llm/providerUtils、chatStateHelpers
 * @created 2026-01-11
 * @modified 2026-01-11
 */

import { buildProviderOptions, nowTime, streamTurnApiV1ChatThread, turnApiV1ChatThread } from "../../shared";
import { maskKey, normalizeText } from "./chatStateHelpers";

function buildUpstream({ api, provider }) {
  const p = String(provider || "");
  const conn = api?.providers?.[p] || { baseUrl: "", key: "", region: "", projectId: "" };
  return {
    provider: p,
    baseUrl: String(conn.baseUrl || ""),
    apiKey: String(conn.key || ""),
    region: p === "vertexai" ? String(conn.region || "") : "",
    projectId: p === "vertexai" ? String(conn.projectId || "") : "",
  };
}

function setDebugClient(debugState, payload) {
  debugState.value = { client: payload, server: null };
}

async function runStreamTurn({ threadId, chat, assistantIdx, body, debugState }) {
  chat.value.splice(assistantIdx, 0, { role: "assistant", content: "", time: nowTime() });
  for await (const evt of streamTurnApiV1ChatThread(threadId, body)) {
    const m = chat.value?.[assistantIdx];
    if (!m) continue;
    if (evt.event === "delta") m.content = `${m.content || ""}${String(evt.data?.text || "")}`;
    if (evt.event === "final") debugState.value.server = evt.data?.debug || null;
  }
}

async function runNonStreamTurn({ threadId, chat, body, debugState }) {
  const out = await turnApiV1ChatThread(threadId, body);
  chat.value.push({ role: "assistant", content: String(out?.assistantText || "").trim() || "（空响应）", time: nowTime() });
  debugState.value.server = out?.debug || null;
}

// 中文注释：
// createChatSendMessage(deps)
// 作用：生成 sendMessage()（含非流式 + SSE 流式）
// 约束：失败不抛出到外层；错误写入 ui.lastError；会在最后 refreshChat() 以服务端为准
// 参数：
//  - deps: { ui, debugState, userInput, sending, chat, api, activePreset, activeProvider, activeConnection, ensureThread, syncThreadMeta, refreshChat }
// 返回：async () => void
export function createChatSendMessage({ ui, debugState, userInput, sending, chat, api, activePreset, activeProvider, activeConnection, ensureThread, syncThreadMeta, refreshChat }) {
  return async function sendMessage() {
    ui.lastError = "";
    debugState.value = null;

    const input = userInput.value.trim();
    if (!input) return;
    if (activeProvider.value === "openai" && !String(activeConnection.value?.baseUrl || "").trim()) return (ui.lastError = "OpenAI Base URL 不能为空。");

    sending.value = true;
    const assistantIdx = chat.value.length + 1;
    chat.value.push({ role: "user", content: input, time: nowTime() });
    userInput.value = "";

    try {
      const id = await ensureThread();
      await syncThreadMeta();

      const upstream = buildUpstream({ api, provider: activeProvider.value });
      const providerOptions = buildProviderOptions({ preset: activePreset.value, provider: activeProvider.value, ui });
      const modelOverride = normalizeText(api.modelOverride) || undefined;

      setDebugClient(debugState, { threadId: id, userText: input, upstream: { ...upstream, apiKeyMasked: maskKey(upstream.apiKey) }, providerOptions, modelOverride });

      const body = { userText: input, upstream, providerOptions, modelOverride, stream: Boolean(ui.stream) };
      if (ui.stream) await runStreamTurn({ threadId: id, chat, assistantIdx, body, debugState });
      else await runNonStreamTurn({ threadId: id, chat, body, debugState });

      await refreshChat();
    } catch (err) {
      ui.lastError = `请求异常：${String(err?.message || err)}`;
      chat.value.push({ role: "assistant", content: `（异常）${ui.lastError}`, time: nowTime() });
    } finally {
      sending.value = false;
    }
  };
}

