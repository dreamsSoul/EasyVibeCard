/**
 * 文件：vcardRoutes.js
 * 模块：server/frameworks/web/apiV1
 * 作用：VCard API（/api/v1/vcard/turn：非流式 + SSE）
 * 依赖：use-cases/vcard/turn、shared/apiError、sendResponse、upstreamLlmGateway
 * @created 2026-01-07
 * @modified 2026-01-13
 */

import crypto from "node:crypto";

import { createUpstreamLlmGateway } from "../../../adapters/gateways/upstreamLlmGateway.js";
import { createUpstreamLlmStreamGateway } from "../../../adapters/gateways/upstreamLlmStreamGateway.js";
import { vcardTurnInteractor } from "../../../use-cases/vcard/turn/interactor.js";
import { toApiError } from "../../../shared/apiError.js";
import { sendOk } from "../sendResponse.js";

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

function createTurnSseEmitter(res) {
  let seq = 0;
  const emit = (type, data) => {
    seq += 1;
    writeSseEvent(res, { id: seq, type, data });
  };
  return { emit };
}

function buildStreamErrorPayload({ apiError, requestId, draftId }) {
  const json = apiError.toJson();
  const details = apiError.details || {};
  return {
    ...json,
    requestId: requestId || undefined,
    draftId: draftId || undefined,
    baseVersion: details.baseVersion ?? undefined,
    latestVersion: details.latestVersion ?? undefined,
    details: json.details ?? undefined,
  };
}

/**
 * 中文注释：
 * attachVcardRoutes(app, deps)
 * 作用：挂载 VCard Turn API（支持 ?stream=true SSE）
 * 约束：SSE 模式下错误通过 event:error 返回并立即终止连接
 * 参数：
 *  - app: any（Express app）
 *  - deps: { draftRepo:any, chatRepo:any, runRepo?:any, runLogRepo:any, idempotencyStore:any }
 * 返回：void
 */
export function attachVcardRoutes(app, deps) {
  app.post(
    "/api/v1/vcard/turn",
    asyncHandler(async (req, res) => {
      const stream = normalizeBoolQuery(req?.query?.stream);
      const body = req?.body || {};

      const requestIdRaw = String(body?.requestId ?? "").trim();
      const requestIdProvided = hasOwn(body, "requestId") && requestIdRaw.length > 0;
      const requestId = requestIdProvided ? requestIdRaw : crypto.randomUUID();
      const draftId = String(body?.draftId || "").trim();
      const input = { ...body, draftId, requestId, stream, __requestIdProvided: requestIdProvided };
      req.__apiContext = { requestId, draftId, baseVersion: body?.baseVersion };

      const llmGateway = createUpstreamLlmGateway({ req, res });
      const llmStreamGateway = createUpstreamLlmStreamGateway({ req });
      const useCaseDeps = { ...deps, llmGateway, llmStreamGateway };

      if (!stream) {
        const out = await vcardTurnInteractor({ deps: useCaseDeps, input });
        return sendOk(res, out);
      }

      setSseHeaders(res);
      const { emit } = createTurnSseEmitter(res);

      try {
        const out = await vcardTurnInteractor({ deps: useCaseDeps, input, emit });
        emit("final", out);
        return res.end();
      } catch (err) {
        const apiError = toApiError(err);
        emit("error", buildStreamErrorPayload({ apiError, requestId: input.requestId, draftId: input.draftId }));
        return res.end();
      }
    }),
  );
}
