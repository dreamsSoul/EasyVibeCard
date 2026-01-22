/**
 * 文件：readLoop.js
 * 模块：server/use-cases/vcard/turn
 * 作用：执行 read-loop（模型→read→把读取内容注入 worldInfoAfter→继续模型）
 * 依赖：server/entities/vcard、server/shared、constants、emit、modelOutput、normalize
 * @created 2026-01-07
 * @modified 2026-01-21
 */

import { ApiError } from "../../../shared/apiError.js";
import { ERROR_CODES } from "../../../shared/errorCodes.js";

import { parseVcardModelOutput } from "../../../entities/vcard/modelOutput.js";

import { emitSafe } from "./emit.js";
import { toModelErrorCode } from "./modelOutput.js";
import { buildVcardTurnMessagesForModel } from "./state.js";

async function callModelOnce({ llmGateway, llmStreamGateway, upstream, providerOptions, preset, model, messages, stream, emit, draftId, requestId, abortSignal }) {
  const requestBody = {
    model,
    messages,
    temperature: preset?.temperature,
    top_p: preset?.top_p,
    top_k: preset?.top_k,
    max_tokens: preset?.openai_max_tokens,
    stream: Boolean(stream),
  };

  if (!stream) return await llmGateway.callChat({ upstream, requestBody: { ...requestBody, stream: false }, providerOptions, abortSignal });

  const streamed = await llmStreamGateway.streamChat({
    upstream,
    requestBody: { ...requestBody, stream: true },
    providerOptions,
    abortSignal,
    onDelta: (delta) => emitSafe(emit, "delta", { requestId, draftId, text: delta }),
  });

  return streamed;
}

function parseItemsOrThrow(assistantText) {
  const parsed = parseVcardModelOutput(assistantText);
  if (parsed.ok) return parsed.items;
  throw new ApiError({ httpStatus: 400, code: toModelErrorCode(parsed.error), message: parsed.error || "输出不符合协议。", details: { stage: "parse_output" } });
}

/**
 * 中文注释：
 * runReadLoop({ ... })
 * 作用：执行模型调用与 read-loop，返回最终 items 与 assistantText
 * 约束：read 不得与 patch 混合；read_result 注入 worldInfoAfterAppend 有长度上限（避免提示词爆炸）
 * 返回：{ assistantText, finalItems, readRounds, providerDebug, paused?:boolean, pauseReason?:string, readContinuation?:any }
 */
export async function runReadLoop({
  draftId,
  requestId,
  mode,
  baseVersion,
  snapshot,
  llmGateway,
  llmStreamGateway,
  upstream,
  providerOptions,
  preset,
  model,
  messages,
  turnPrompt,
  emit,
  stream,
  abortSignal,
}) {
  let assistantText = "";
  let finalItems = [];
  let providerDebug = {};

  const worldInfoAfterAppend = String(turnPrompt?.worldInfoAfterAppend || "").trim();
  const roundMessages =
    turnPrompt && typeof turnPrompt === "object"
      ? buildVcardTurnMessagesForModel({ ...turnPrompt, worldInfoAfterAppend })
      : Array.isArray(messages)
        ? messages
        : [];

  const called = await callModelOnce({
    llmGateway,
    llmStreamGateway,
    upstream,
    providerOptions,
    preset,
    model,
    messages: roundMessages,
    stream,
    emit,
    draftId,
    requestId,
    abortSignal,
  });
  providerDebug = called?.debug || {};
  if (!called?.ok) {
    throw new ApiError({ httpStatus: 502, code: ERROR_CODES.UPSTREAM_ERROR, message: called?.error || "上游错误。", details: { stage: "call_upstream" } });
  }

  assistantText = String(called.assistantText || "");
  if (!stream) emitSafe(emit, "delta", { requestId, draftId, text: assistantText });
  finalItems = parseItemsOrThrow(assistantText);

  return { assistantText, finalItems, readRounds: 0, providerDebug, paused: false, pauseReason: "", readContinuation: null };
}
