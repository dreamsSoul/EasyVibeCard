/**
 * 文件：turnInteractor.js
 * 模块：server/use-cases/chatThreads
 * 作用：Chat Thread Turn（后端组装 messages + 调用上游 + 落库 + SSE delta）
 * 依赖：server/entities/presets、server/shared
 * @created 2026-01-11
 * @modified 2026-01-11
 */

import { BUILTIN_DEFAULT_PRESET } from "../../entities/presets/builtinDefaultPreset.js";
import { buildMessages } from "../../entities/presets/buildMessages.js";
import { normalizeProvider, pickModelFromPreset, pickUseSystemPromptFromPreset } from "../../entities/presets/providerUtils.js";
import { ApiError } from "../../shared/apiError.js";
import { ERROR_CODES } from "../../shared/errorCodes.js";
import { maskApiKey } from "../../shared/mask.js";

function normalizeText(value) {
  return String(value ?? "").trim();
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function toBool(value) {
  return Boolean(value);
}

function pickSettingsProviderConn(settings, provider) {
  const providers = settings?.apiNonSensitive?.providers;
  const obj = providers && typeof providers === "object" ? providers : {};
  const conn = obj?.[provider];
  return conn && typeof conn === "object" ? conn : {};
}

function buildUpstreamFromInput({ settings, provider, upstreamInput }) {
  const upstream = isPlainObject(upstreamInput) ? upstreamInput : {};
  const conn = pickSettingsProviderConn(settings, provider);

  const baseUrl = normalizeText(upstream.baseUrl || conn.baseUrl || "");
  const apiKey = normalizeText(upstream.apiKey || "");

  if (provider === "vertexai") {
    const region = normalizeText(upstream.region || conn.region || "");
    const projectId = normalizeText(upstream.projectId || conn.projectId || "");
    return { provider, baseUrl, apiKey, region, projectId };
  }

  return { provider, baseUrl, apiKey };
}

function buildProviderOptions({ settings, preset, provider, requestProviderOptions }) {
  const ui = settings?.ui && typeof settings.ui === "object" ? settings.ui : {};
  const base = {
    useSystemPrompt: pickUseSystemPromptFromPreset(preset, provider),
    reasoningEffort: normalizeText(ui.reasoningEffort || "auto") || "auto",
    includeReasoning: Boolean(ui.includeReasoning),
  };

  const p = isPlainObject(requestProviderOptions) ? requestProviderOptions : {};
  return {
    useSystemPrompt: p.useSystemPrompt === undefined ? base.useSystemPrompt : Boolean(p.useSystemPrompt),
    reasoningEffort: p.reasoningEffort === undefined ? base.reasoningEffort : normalizeText(p.reasoningEffort || "auto") || "auto",
    includeReasoning: p.includeReasoning === undefined ? base.includeReasoning : Boolean(p.includeReasoning),
  };
}

function pickProvider({ upstreamInput, settings, preset }) {
  const requested = normalizeText(upstreamInput?.provider);
  if (requested) return normalizeProvider(requested);
  const override = normalizeText(settings?.apiNonSensitive?.providerOverride);
  if (override) return normalizeProvider(override);
  return normalizeProvider(preset?.chat_completion_source);
}

function pickModel({ modelOverride, settings, preset, provider }) {
  const requestOverride = normalizeText(modelOverride);
  if (requestOverride) return requestOverride;
  const globalOverride = normalizeText(settings?.apiNonSensitive?.modelOverride);
  if (globalOverride) return globalOverride;
  return normalizeText(pickModelFromPreset(preset, provider)) || "gpt-4o-mini";
}

async function loadPresetOrThrow(presetRepo, presetName) {
  const name = normalizeText(presetName);
  if (!name) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "presetName 不能为空。" });
  if (name === normalizeText(BUILTIN_DEFAULT_PRESET.name)) return BUILTIN_DEFAULT_PRESET;
  const row = await presetRepo.getPresetByName({ name });
  if (!row?.preset) throw new ApiError({ httpStatus: 404, code: ERROR_CODES.PRESET_NOT_FOUND, message: "预设不存在。" });
  return row.preset;
}

async function loadRecentChatMessages(chatThreadRepo, threadId) {
  const page = await chatThreadRepo.getThreadMessagesPage({ threadId, beforeSeq: null, limit: 32 });
  const items = Array.isArray(page?.items) ? page.items : [];
  return items.map((m) => ({ role: m.role, content: String(m.content || "") }));
}

function buildDebugUpstream({ provider, apiKey }) {
  return { provider: normalizeText(provider) || "openai", apiKeyMasked: maskApiKey(apiKey) };
}

function emitSafe(emit, type, data) {
  if (typeof emit !== "function") return;
  emit(type, data);
}

/**
 * 中文注释：
 * chatThreadTurnInteractor({ deps, input, emit })
 * 作用：执行单轮对话：写入 user 消息、后端组装 messages、调用上游、写入 assistant 消息
 * 约束：SSE 时通过 emit 输出 meta/delta；最终结果由返回值承载
 * 参数：
 *  - deps: { chatThreadRepo, presetRepo, settingsRepo, llmGateway, llmStreamGateway }
 *  - input: { requestId, threadId, userText, upstream, providerOptions, modelOverride, stream }
 *  - emit?: (type:string,data:any)=>void
 * 返回：Promise<{ requestId, threadId, assistantText, userMessage, assistantMessage, debug }>
 */
export async function chatThreadTurnInteractor({ deps, input, emit }) {
  const { chatThreadRepo, presetRepo, settingsRepo, llmGateway, llmStreamGateway } = deps || {};
  if (!chatThreadRepo?.getThreadById) throw new Error("chatThreadRepo.getThreadById 缺失。");
  if (!chatThreadRepo?.appendThreadMessages) throw new Error("chatThreadRepo.appendThreadMessages 缺失。");
  if (!presetRepo?.getPresetByName) throw new Error("presetRepo.getPresetByName 缺失。");
  if (!settingsRepo?.getSettings) throw new Error("settingsRepo.getSettings 缺失。");
  if (!llmGateway?.callChat) throw new Error("llmGateway.callChat 缺失。");

  const requestId = normalizeText(input?.requestId);
  const threadId = normalizeText(input?.threadId);
  const userText = normalizeText(input?.userText);
  const stream = toBool(input?.stream);

  if (!requestId) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "requestId 不能为空。" });
  if (!threadId) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "threadId 不能为空。" });
  if (!userText) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "userText 不能为空。" });

  const thread = await chatThreadRepo.getThreadById({ threadId });
  if (!thread) throw new ApiError({ httpStatus: 404, code: ERROR_CODES.CHAT_THREAD_NOT_FOUND, message: "会话不存在。" });

  const settings = await settingsRepo.getSettings();
  const preset = await loadPresetOrThrow(presetRepo, thread.presetName);
  const provider = pickProvider({ upstreamInput: input?.upstream, settings, preset });
  const model = pickModel({ modelOverride: input?.modelOverride, settings, preset, provider });

  const upstream = buildUpstreamFromInput({ settings, provider, upstreamInput: input?.upstream });
  if (provider === "openai" && !normalizeText(upstream.baseUrl)) {
    throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "OpenAI Base URL 不能为空。" });
  }

  const providerOptions = buildProviderOptions({ settings, preset, provider, requestProviderOptions: input?.providerOptions });
  const chat = await loadRecentChatMessages(chatThreadRepo, threadId);
  const messages = buildMessages({ preset, ctx: thread.ctx, chat, userInput: userText, useSystemPrompt: providerOptions.useSystemPrompt });

  const requestBody = {
    model,
    messages,
    temperature: preset?.temperature,
    top_p: preset?.top_p,
    top_k: preset?.top_k,
    max_tokens: preset?.openai_max_tokens,
    stream,
  };

  const appendedUser = await chatThreadRepo.appendThreadMessages({ threadId, messages: [{ role: "user", content: userText }] });
  const userMessage = appendedUser?.inserted?.[0] || null;

  const debugUpstream = buildDebugUpstream({ provider, apiKey: upstream.apiKey });

  if (!stream) {
    const called = await llmGateway.callChat({ upstream, requestBody: { ...requestBody, stream: false }, providerOptions });
    if (!called?.ok) {
      throw new ApiError({ httpStatus: 502, code: ERROR_CODES.UPSTREAM_ERROR, message: called?.error || "上游错误。", details: { stage: "call_upstream" } });
    }

    const assistantText = normalizeText(called.assistantText);
    const appendedAssistant = await chatThreadRepo.appendThreadMessages({ threadId, messages: [{ role: "assistant", content: assistantText }] });
    const assistantMessage = appendedAssistant?.inserted?.[0] || null;

    return {
      requestId,
      threadId,
      assistantText,
      userMessage,
      assistantMessage,
      debug: { upstream: debugUpstream, ...(called?.debug || {}) },
    };
  }

  if (!llmStreamGateway?.streamChat) throw new Error("llmStreamGateway.streamChat 缺失。");

  emitSafe(emit, "meta", { requestId, threadId, provider: debugUpstream.provider, model });

  const streamed = await llmStreamGateway.streamChat({
    upstream,
    requestBody,
    providerOptions,
    onDelta: (delta) => emitSafe(emit, "delta", { requestId, text: delta }),
  });

  if (!streamed?.ok) {
    throw new ApiError({ httpStatus: 502, code: ERROR_CODES.UPSTREAM_ERROR, message: streamed?.error || "上游错误。", details: { stage: "call_upstream" } });
  }

  const assistantText = normalizeText(streamed.assistantText);
  const appendedAssistant = await chatThreadRepo.appendThreadMessages({ threadId, messages: [{ role: "assistant", content: assistantText }] });
  const assistantMessage = appendedAssistant?.inserted?.[0] || null;

  return {
    requestId,
    threadId,
    assistantText,
    userMessage,
    assistantMessage,
    debug: { upstream: debugUpstream, ...(streamed?.debug || {}) },
  };
}

