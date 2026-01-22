/**
 * 文件：runner.js
 * 模块：server/use-cases/vcard/runs
 * 作用：后台执行 Run（多轮 turn + 事件落库 + stopReason）
 * 依赖：server/use-cases/vcard/turn、server/shared/apiError、server/adapters/gateways/upstreamLlmGateway
 * @created 2026-01-08
 * @modified 2026-01-08
 */

import crypto from "node:crypto";

import { createUpstreamLlmGateway } from "../../../adapters/gateways/upstreamLlmGateway.js";
import { createUpstreamLlmStreamGateway } from "../../../adapters/gateways/upstreamLlmStreamGateway.js";
import { toApiError } from "../../../shared/apiError.js";
import { ERROR_CODES } from "../../../shared/errorCodes.js";
import { vcardTurnInteractor } from "../turn/interactor.js";

import { RUN_STOP_REASONS, RUN_STATUS } from "./constants.js";
import { clearRunAbortController, registerRunAbortController } from "./runRegistry.js";

function nowIso() {
  return new Date().toISOString();
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function safeStopReason(value) {
  const s = String(value || "").trim();
  return s || RUN_STOP_REASONS.CANCELED;
}

function buildErrorEventPayload({ apiError, ctx }) {
  const json = apiError.toJson();
  const details = apiError.details || {};
  return {
    ...json,
    runId: ctx.runId,
    turnIndex: ctx.turnIndex,
    requestId: ctx.requestId,
    draftId: ctx.draftId,
    baseVersion: details.baseVersion ?? ctx.baseVersion ?? undefined,
    latestVersion: details.latestVersion ?? undefined,
    details: json.details ?? undefined,
  };
}

function isVibePlanAllDone(snapshot) {
  const plan = snapshot?.raw?.dataExtensions?.vibePlan;
  if (!isPlainObject(plan)) return false;
  const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
  if (tasks.length === 0) return false;
  return tasks.every((t) => String(t?.status || "") === "done");
}

function createDbEmitter({ runEventRepo, runId, draftId, turnIndex }) {
  let chain = Promise.resolve();

  const emit = (type, data) => {
    const payload = isPlainObject(data) ? data : {};
    const enriched = { ...payload, runId, turnIndex, draftId };
    chain = chain.then(() => runEventRepo.appendEvent({ runId, type, data: enriched })).catch(() => undefined);
    return chain;
  };

  const flush = async () => {
    await chain;
  };

  return { emit, flush };
}

async function appendFinal({ runEventRepo, run, result, stopReason, stopMessage }) {
  const payload = {
    ok: true,
    runId: run.runId,
    requestId: run.requestId || undefined,
    draftId: run.draftId,
    baseVersion: run.baseVersion,
    version: result?.version ?? run.version,
    stopReason,
    stopMessage,
    turns: result?.turns ?? run.turns,
    snapshot: result?.snapshot ?? {},
    runLog: result?.runLog ?? undefined,
    debug: result?.debug ?? undefined,
  };
  await runEventRepo.appendEvent({ runId: run.runId, type: "final", data: payload });
}

function createRunState(run) {
  return {
    turns: 0,
    version: Number(run.version) || Number(run.baseVersion) || 1,
    stopReason: "",
    stopMessage: "",
    noChangeStreak: 0,
    lastTurnOut: null,
  };
}

async function checkRunStillRunning(runRepo, runId) {
  const current = await runRepo.getRun({ runId });
  if (!current) return { ok: false, stopReason: RUN_STOP_REASONS.ERROR, stopMessage: "Run 不存在（可能已被删除）。", current: null };
  if (current.status !== RUN_STATUS.RUNNING) {
    return { ok: false, stopReason: safeStopReason(current.stopReason), stopMessage: current.stopMessage || "Run 已停止。", current };
  }
  return { ok: true, current };
}

function startPingTimer(emit, requestId) {
  const timer = setInterval(() => emit("ping", { requestId, ts: nowIso() }), 3000);
  return () => clearInterval(timer);
}

function isTerminalEventType(type) {
  const t = String(type || "").trim();
  return t === "final" || t === "error";
}

function updateStreaks(state, { changedPaths }) {
  const changed = Array.isArray(changedPaths) ? changedPaths : [];
  state.noChangeStreak = changed.length === 0 ? state.noChangeStreak + 1 : 0;
}

function isAbortError(err) {
  const name = String(err?.name || "").trim();
  const code = String(err?.code || "").trim();
  if (name === "AbortError" || code === "ABORT_ERR") return true;
  const msg = String(err?.message || "").toLowerCase();
  return msg.includes("abort");
}

function pickStopAfterSuccess({ input, state, out, turnIndex }) {
  const changed = Array.isArray(out?.runLog?.changedPaths) ? out.runLog.changedPaths : [];
  const kinds = Array.isArray(out?.runLog?.kinds) ? out.runLog.kinds : [];

  // 未调用任何工具（纯文本输出）：视为“与用户对话/提问”，停止 Run，避免空转。
  if (kinds.length === 0) {
    return { ok: true, stopReason: RUN_STOP_REASONS.DONE, stopMessage: "模型未调用工具（纯文本输出），Run 已停止。" };
  }

  if (isVibePlanAllDone(out?.snapshot)) {
    return { ok: true, stopReason: RUN_STOP_REASONS.DONE, stopMessage: "vibePlan 已完成，Run 已停止。" };
  }

  if (state.noChangeStreak >= input.runOptions.noChangeTurns) {
    return { ok: true, stopReason: RUN_STOP_REASONS.NO_CHANGE, stopMessage: `连续 ${input.runOptions.noChangeTurns} 轮无产物变化，已停止。` };
  }

  if (turnIndex >= input.runOptions.maxTurns) {
    return { ok: true, stopReason: RUN_STOP_REASONS.MAX_TURNS, stopMessage: `达到最大轮次（${input.runOptions.maxTurns}），已停止。` };
  }

  return { ok: false, stopReason: "", stopMessage: "", changedPaths: changed };
}

async function runOneTurn({ deps, llmGateway, llmStreamGateway, run, input, state, turnIndex }) {
  const requestId = crypto.randomUUID();
  const { emit, flush } = createDbEmitter({ runEventRepo: deps.runEventRepo, runId: run.runId, draftId: run.draftId, turnIndex });
  const stopPing = startPingTimer(emit, requestId);
  const controller = new AbortController();
  registerRunAbortController(run.runId, controller);

  try {
    const out = await vcardTurnInteractor({
      deps: {
        draftRepo: deps.draftRepo,
        chatRepo: deps.chatRepo,
        pendingRepo: deps.pendingRepo,
        runLogRepo: deps.runLogRepo,
        idempotencyStore: deps.idempotencyStore,
        llmGateway,
        llmStreamGateway,
        presetRepo: deps.presetRepo,
        settingsRepo: deps.settingsRepo,
      },
      input: {
        ...input,
        draftId: run.draftId,
        baseVersion: state.version,
        requestId,
        __requestIdProvided: false,
        stream: true,
        runId: run.runId,
        turnIndex,
        abortSignal: controller.signal,
      },
      emit,
    });
    return { ok: true, requestId, out, flush, stopPing };
  } catch (err) {
    const aborted = isAbortError(err);
    const apiError = toApiError(err);
    if (!aborted) {
      emit("error", buildErrorEventPayload({ apiError, ctx: { runId: run.runId, turnIndex, requestId, draftId: run.draftId, baseVersion: state.version } }));
    }
    return { ok: false, requestId, apiError, flush, stopPing, aborted };
  } finally {
    clearRunAbortController(run.runId, controller);
  }
}

async function hasTerminalEvent(runEventRepo, runId) {
  const meta = await runEventRepo.getLatestEventMeta({ runId }).catch(() => null);
  if (!meta) return false;
  return isTerminalEventType(meta.type);
}

async function stopRunAndMaybeEmitFinal({ deps, run, state }) {
  const finalDraft = await deps.draftRepo.getDraft({ draftId: run.draftId }).catch(() => null);
  const snapshot = finalDraft?.snapshot ?? state.lastTurnOut?.snapshot ?? {};
  const version = finalDraft?.version ?? state.lastTurnOut?.version ?? state.version;
  const turns = state.turns;

  const reason = safeStopReason(state.stopReason || RUN_STOP_REASONS.MAX_TURNS);
  await deps.runRepo.stopRun({ runId: run.runId, stopReason: reason, stopMessage: state.stopMessage, turns, version });
  if (reason === RUN_STOP_REASONS.ERROR) return;
  if (await hasTerminalEvent(deps.runEventRepo, run.runId)) return;

  await appendFinal({
    runEventRepo: deps.runEventRepo,
    run,
    stopReason: reason,
    stopMessage: state.stopMessage,
    result: { version, turns, snapshot, runLog: state.lastTurnOut?.runLog, debug: state.lastTurnOut?.debug },
  }).catch(() => undefined);
}

async function syncStopFromRepo({ runRepo, runId, state }) {
  const running = await checkRunStillRunning(runRepo, runId);
  if (running.ok) return { shouldStop: false };

  state.stopReason = running.stopReason;
  state.stopMessage = running.stopMessage;
  state.turns = running.current?.turns ?? state.turns;
  state.version = running.current?.version ?? state.version;
  return { shouldStop: true };
}

function buildTurnInput(input, turnIndex) {
  if (turnIndex === 1) return input;
  return { ...input, userText: "" };
}

async function executeTurnIndex({ deps, llmGateway, llmStreamGateway, run, input, state, turnIndex }) {
  const turn = await runOneTurn({ deps, llmGateway, llmStreamGateway, run, input: buildTurnInput(input, turnIndex), state, turnIndex });
  turn.stopPing();
  await turn.flush();

  if (!turn.ok) {
    if (turn.aborted) {
      state.stopReason = RUN_STOP_REASONS.CANCELED;
      state.stopMessage = "用户取消。";
      return { shouldStop: true };
    }

    state.stopReason = RUN_STOP_REASONS.ERROR;
    state.stopMessage = turn.apiError.code === ERROR_CODES.VERSION_CONFLICT ? "版本冲突，Run 已停止。" : String(turn.apiError.message || "运行失败");
    return { shouldStop: true };
  }

  state.lastTurnOut = turn.out;
  state.turns = turnIndex;
  state.version = Number(turn.out?.version) || state.version;
  await deps.runRepo.updateProgress({ runId: run.runId, turns: state.turns, version: state.version });

  updateStreaks(state, { changedPaths: turn.out?.runLog?.changedPaths });
  const stop = pickStopAfterSuccess({ input, state, out: turn.out, turnIndex });
  if (stop.ok) {
    state.stopReason = stop.stopReason;
    state.stopMessage = stop.stopMessage;
    return { shouldStop: true };
  }

  return { shouldStop: false };
}

async function executeRunLoop({ deps, run, input }) {
  const llmGateway = createUpstreamLlmGateway({ req: null, res: null });
  const llmStreamGateway = createUpstreamLlmStreamGateway({ req: null });
  const state = createRunState(run);

  for (let turnIndex = 1; turnIndex <= input.runOptions.maxTurns; turnIndex++) {
    const synced = await syncStopFromRepo({ runRepo: deps.runRepo, runId: run.runId, state });
    if (synced.shouldStop) break;

    const executed = await executeTurnIndex({ deps, llmGateway, llmStreamGateway, run, input, state, turnIndex });
    if (executed.shouldStop) break;
  }

  await stopRunAndMaybeEmitFinal({ deps, run, state });
}

/**
 * 中文注释：
 * startVcardRunInBackground({ deps, run, input })
 * 作用：后台启动 Run（不阻塞 HTTP 请求），并把事件写入 run_events
 * 约束：当前实现不保证进程重启后的续跑；cancel 会尝试立即 abort in-flight 请求
 * 参数：
 *  - deps: { draftRepo, chatRepo, runRepo, runEventRepo, runLogRepo, idempotencyStore }
 *  - run: { runId, draftId, baseVersion, version, requestId? }
 *  - input: { mode, reason, userText, preset, ctx, upstream, providerOptions, runOptions, model }
 * 返回：void
 */
export function startVcardRunInBackground({ deps, run, input }) {
  setImmediate(() => executeRunLoop({ deps, run, input }).catch(() => undefined));
}
