/**
 * 文件：vcardRunsRoutes.js
 * 模块：server/frameworks/web/apiV1
 * 作用：VCard Run API（/api/v1/vcard/runs：start/status/events/result/cancel）
 * 依赖：use-cases/vcard/runs、shared/apiError、sendResponse
 * @created 2026-01-08
 * @modified 2026-01-08
 */

import { ApiError, toApiError } from "../../../shared/apiError.js";
import { ERROR_CODES } from "../../../shared/errorCodes.js";
import {
  cancelVcardRunInteractor,
  getVcardRunInteractor,
  getVcardRunResultInteractor,
  startVcardRunInteractor,
} from "../../../use-cases/vcard/runs/interactor.js";
import { sendOk } from "../sendResponse.js";

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
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

function parseLastEventId(req) {
  const raw = String(req?.headers?.["last-event-id"] ?? "").trim();
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  const i = Math.trunc(n);
  return i > 0 ? i : 0;
}

function isTerminalEventType(type) {
  const t = String(type || "").trim();
  return t === "final" || t === "error";
}

function buildRunStreamErrorPayload({ apiError, run }) {
  const json = apiError.toJson();
  return {
    ...json,
    runId: json.runId ?? run?.runId ?? undefined,
    draftId: json.draftId ?? run?.draftId ?? undefined,
    requestId: json.requestId ?? run?.requestId ?? undefined,
    baseVersion: json.baseVersion ?? run?.baseVersion ?? undefined,
    details: json.details ?? undefined,
  };
}

async function readAndSendEvents({ res, deps, runId, afterSeq }) {
  const events = await deps.runEventRepo.listEventsAfter({ runId, afterSeq, limit: 200 });
  let cursor = afterSeq;

  for (const e of events) {
    writeSseEvent(res, { id: e.seq, type: e.type, data: e.data });
    cursor = e.seq;
  }

  const lastType = events.length > 0 ? events[events.length - 1].type : "";
  return { afterSeq: cursor, lastType, count: events.length };
}

async function shouldEndIfStopped(deps, runId) {
  const latest = await deps.runRepo.getRun({ runId });
  if (!latest) throw new ApiError({ httpStatus: 404, code: ERROR_CODES.RUN_NOT_FOUND, message: "Run 不存在。" });
  return latest.status === "stopped";
}

async function streamRunEvents({ req, res, deps, run }) {
  setSseHeaders(res);
  res.write(": connected\n\n");

  const state = { afterSeq: parseLastEventId(req), closed: false, inFlight: false, timer: null };
  const stop = () => {
    state.closed = true;
    if (state.timer) clearInterval(state.timer);
  };

  req.on("close", () => stop());

  const pump = async () => {
    if (state.closed || state.inFlight) return;
    state.inFlight = true;

    try {
      const sent = await readAndSendEvents({ res, deps, runId: run.runId, afterSeq: state.afterSeq });
      state.afterSeq = sent.afterSeq;

      if (isTerminalEventType(sent.lastType)) {
        stop();
        return res.end();
      }

      if (sent.count === 0 && (await shouldEndIfStopped(deps, run.runId))) {
        stop();
        return res.end();
      }
    } catch (err) {
      const apiError = toApiError(err);
      writeSseEvent(res, { type: "error", data: buildRunStreamErrorPayload({ apiError, run }) });
      stop();
      return res.end();
    } finally {
      state.inFlight = false;
    }
  };

  await pump();
  state.timer = setInterval(() => pump().catch(() => undefined), 500);
}

/**
 * 中文注释：
 * attachVcardRunRoutes(app, deps)
 * 作用：挂载 VCard Run API（start/status/events/result/cancel）
 * 约束：events 为 SSE；必须支持 Last-Event-ID 续播（通过 run_events.seq）
 * 参数：
 *  - app: any（Express app）
 *  - deps: { draftRepo, chatRepo, runRepo, runEventRepo, runLogRepo, idempotencyStore }
 * 返回：void
 */
export function attachVcardRunRoutes(app, deps) {
  app.post(
    "/api/v1/vcard/runs",
    asyncHandler(async (req, res) => {
      const out = await startVcardRunInteractor({ deps, input: req?.body || {} });
      return sendOk(res, out);
    }),
  );

  app.get(
    "/api/v1/vcard/runs/:runId",
    asyncHandler(async (req, res) => {
      const runId = String(req?.params?.runId || "");
      const out = await getVcardRunInteractor({ deps, runId });
      return sendOk(res, out);
    }),
  );

  app.get(
    "/api/v1/vcard/runs/:runId/result",
    asyncHandler(async (req, res) => {
      const runId = String(req?.params?.runId || "");
      const out = await getVcardRunResultInteractor({ deps, runId });
      return sendOk(res, out);
    }),
  );

  app.post(
    "/api/v1/vcard/runs/:runId/cancel",
    asyncHandler(async (req, res) => {
      const runId = String(req?.params?.runId || "");
      const out = await cancelVcardRunInteractor({ deps, runId });
      return sendOk(res, out);
    }),
  );

  app.get(
    "/api/v1/vcard/runs/:runId/events",
    asyncHandler(async (req, res) => {
      const runId = String(req?.params?.runId || "");
      const run = await deps?.runRepo?.getRun?.({ runId });
      if (!run) throw new ApiError({ httpStatus: 404, code: ERROR_CODES.RUN_NOT_FOUND, message: "Run 不存在。" });
      return await streamRunEvents({ req, res, deps, run });
    }),
  );
}
