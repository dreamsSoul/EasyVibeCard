/**
 * 文件：chatThreadsRoutes.js
 * 模块：server/frameworks/web/apiV1
 * 作用：Chat Threads API（/api/v1/chat/threads/*）
 * 依赖：use-cases/chatThreads、sendResponse、upstream gateways
 * @created 2026-01-11
 * @modified 2026-01-11
 */

import crypto from "node:crypto";

import { createUpstreamLlmGateway } from "../../../adapters/gateways/upstreamLlmGateway.js";
import { createUpstreamLlmStreamGateway } from "../../../adapters/gateways/upstreamLlmStreamGateway.js";
import { toApiError } from "../../../shared/apiError.js";
import { sendOk } from "../sendResponse.js";
import {
  clearChatThreadInteractor,
  createChatThreadInteractor,
  getChatThreadInteractor,
  getChatThreadMessagesInteractor,
  patchChatThreadInteractor,
} from "../../../use-cases/chatThreads/threadInteractors.js";
import { chatThreadTurnInteractor } from "../../../use-cases/chatThreads/turnInteractor.js";

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function normalizeBoolQuery(value) {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function setSseHeaders(res) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
}

function writeSseEvent(res, { id, type, data }) {
  const payload = JSON.stringify(data ?? {});
  if (id !== null && id !== undefined) res.write(`id: ${id}\n`);
  res.write(`event: ${String(type || "message")}\n`);
  res.write(`data: ${payload}\n\n`);
}

function createSseEmitter(res) {
  let seq = 0;
  const emit = (type, data) => {
    seq += 1;
    writeSseEvent(res, { id: seq, type, data });
  };
  return { emit };
}

function buildStreamErrorPayload({ apiError, requestId }) {
  const json = apiError.toJson();
  return {
    ok: false,
    code: json.code,
    message: json.message,
    requestId: requestId || json.requestId || undefined,
  };
}

/**
 * 中文注释：
 * attachChatThreadRoutes(app, deps)
 * 作用：挂载 Chat Threads API（会话 + 消息分页 + turn）
 * 约束：turn 的 SSE 为后端自定义格式（meta/delta/final/error），不透传上游 SSE
 * 参数：
 *  - app: any（Express app）
 *  - deps: { chatThreadRepo:any, presetRepo:any, settingsRepo:any }
 * 返回：void
 */
export function attachChatThreadRoutes(app, deps) {
  app.post(
    "/api/v1/chat/threads",
    asyncHandler(async (req, res) => {
      const body = req?.body || {};
      const out = await createChatThreadInteractor({
        chatThreadRepo: deps.chatThreadRepo,
        presetRepo: deps.presetRepo,
        settingsRepo: deps.settingsRepo,
        name: body?.name,
        presetName: body?.presetName,
        ctx: body?.ctx,
      });
      return sendOk(res, out);
    }),
  );

  app.get(
    "/api/v1/chat/threads/:threadId",
    asyncHandler(async (req, res) => {
      const threadId = String(req?.params?.threadId || "");
      const out = await getChatThreadInteractor({ chatThreadRepo: deps.chatThreadRepo, threadId });
      return sendOk(res, out);
    }),
  );

  app.patch(
    "/api/v1/chat/threads/:threadId",
    asyncHandler(async (req, res) => {
      const threadId = String(req?.params?.threadId || "");
      const body = req?.body || {};
      const out = await patchChatThreadInteractor({
        chatThreadRepo: deps.chatThreadRepo,
        presetRepo: deps.presetRepo,
        threadId,
        name: body?.name,
        presetName: body?.presetName,
        ctx: body?.ctx,
      });
      return sendOk(res, out);
    }),
  );

  app.get(
    "/api/v1/chat/threads/:threadId/messages",
    asyncHandler(async (req, res) => {
      const threadId = String(req?.params?.threadId || "");
      const { beforeSeq, limit } = req?.query || {};
      const out = await getChatThreadMessagesInteractor({ chatThreadRepo: deps.chatThreadRepo, threadId, beforeSeq, limit });
      return sendOk(res, out);
    }),
  );

  app.post(
    "/api/v1/chat/threads/:threadId/clear",
    asyncHandler(async (req, res) => {
      const threadId = String(req?.params?.threadId || "");
      const out = await clearChatThreadInteractor({ chatThreadRepo: deps.chatThreadRepo, threadId });
      return sendOk(res, out);
    }),
  );

  app.post(
    "/api/v1/chat/threads/:threadId/turn",
    asyncHandler(async (req, res) => {
      const stream = normalizeBoolQuery(req?.query?.stream);
      const body = req?.body || {};

      const requestIdRaw = String(body?.requestId ?? "").trim();
      const requestIdProvided = hasOwn(body, "requestId") && requestIdRaw.length > 0;
      const requestId = requestIdProvided ? requestIdRaw : crypto.randomUUID();
      const threadId = String(req?.params?.threadId || "").trim();
      req.__apiContext = { requestId };

      const llmGateway = createUpstreamLlmGateway({ req, res });
      const llmStreamGateway = createUpstreamLlmStreamGateway({ req });
      const useCaseDeps = { ...deps, llmGateway, llmStreamGateway };
      const input = { ...body, requestId, threadId, stream };

      if (!stream) {
        const out = await chatThreadTurnInteractor({ deps: useCaseDeps, input });
        return sendOk(res, out);
      }

      setSseHeaders(res);
      const { emit } = createSseEmitter(res);

      try {
        const out = await chatThreadTurnInteractor({ deps: useCaseDeps, input, emit });
        emit("final", { ok: true, ...out });
        return res.end();
      } catch (err) {
        const apiError = toApiError(err);
        emit("error", buildStreamErrorPayload({ apiError, requestId }));
        return res.end();
      }
    }),
  );
}
