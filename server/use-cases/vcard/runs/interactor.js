/**
 * 文件：interactor.js
 * 模块：server/use-cases/vcard/runs
 * 作用：VCard Run 用例入口（start/get/result/cancel）
 * 依赖：server/shared/apiError、server/shared/errorCodes、normalize、runner
 * @created 2026-01-08
 * @modified 2026-01-08
 */

import { ApiError } from "../../../shared/apiError.js";
import { ERROR_CODES } from "../../../shared/errorCodes.js";

import { IDEMPOTENCY_KIND_VCARD_RUN_START, RUN_STATUS, RUN_STOP_REASONS } from "./constants.js";
import { assertRunDeps } from "./deps.js";
import { isPlainObject, normalizeRunOptions, normalizeText, pickModelFromInput } from "./normalize.js";
import { startVcardRunInBackground } from "./runner.js";
import { abortRunById } from "./runRegistry.js";

function normalizeRunStartInput(input) {
  const draftId = normalizeText(input?.draftId);
  const baseVersion = Number(input?.baseVersion);
  const requestId = normalizeText(input?.requestId);
  const clientRequestId = requestId || "";
  const presetName = normalizeText(input?.presetName);

  return {
    draftId,
    baseVersion,
    clientRequestId,
    requestedMode: normalizeText(input?.mode || "auto"),
    reason: normalizeText(input?.reason),
    userText: normalizeText(input?.userText),
    presetName,
    preset: isPlainObject(input?.preset) ? input.preset : null,
    ctx: isPlainObject(input?.ctx) ? input.ctx : {},
    upstream: isPlainObject(input?.upstream) ? input.upstream : {},
    providerOptions: isPlainObject(input?.providerOptions) ? input.providerOptions : {},
    runOptions: normalizeRunOptions(input?.runOptions),
    model: pickModelFromInput(input),
  };
}

async function ensureDraftVersion(draftRepo, { draftId, baseVersion }) {
  if (!draftId) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "draftId 不能为空。" });
  if (!Number.isFinite(baseVersion) || baseVersion < 1) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "baseVersion 非法。" });

  const meta = await draftRepo.getDraftMeta({ draftId });
  if (!meta) throw new ApiError({ httpStatus: 404, code: ERROR_CODES.DRAFT_NOT_FOUND, message: "草稿不存在。" });
  if (meta.headVersion !== baseVersion) {
    throw new ApiError({
      httpStatus: 409,
      code: ERROR_CODES.VERSION_CONFLICT,
      message: "baseVersion 与 latestVersion 不一致。",
      details: { baseVersion, latestVersion: meta.headVersion },
    });
  }

  return meta;
}

function buildRunStartResult(run) {
  return { runId: run.runId, draftId: run.draftId, baseVersion: run.baseVersion, version: run.version, status: run.status };
}

async function tryReadStartIdempotency(idempotencyStore, normalized) {
  if (!normalized.clientRequestId) return null;
  return await idempotencyStore.get({
    draftId: normalized.draftId,
    requestId: normalized.clientRequestId,
    kind: IDEMPOTENCY_KIND_VCARD_RUN_START,
  });
}

async function ensureNoOtherRunningRun(runRepo, normalized) {
  const running = await runRepo.findRunningByDraftId({ draftId: normalized.draftId });
  if (!running?.runId) return null;
  if (normalized.clientRequestId && running.requestId === normalized.clientRequestId) return buildRunStartResult(running);

  throw new ApiError({
    httpStatus: 409,
    code: ERROR_CODES.DRAFT_BUSY,
    message: "草稿存在进行中的 Run，请先停止或复用已有 runId。",
    details: { runId: running.runId },
  });
}

async function createRunWithIdempotency({ runRepo, idempotencyStore, normalized }) {
  const run = await runRepo.createRun({
    draftId: normalized.draftId,
    requestId: normalized.clientRequestId || null,
    baseVersion: normalized.baseVersion,
  });

  const result = buildRunStartResult(run);
  if (!normalized.clientRequestId) return { run, result };

  await idempotencyStore.setIfAbsent({
    draftId: normalized.draftId,
    requestId: normalized.clientRequestId,
    kind: IDEMPOTENCY_KIND_VCARD_RUN_START,
    result,
  });

  return { run, result };
}

/**
 * 中文注释：
 * startVcardRunInteractor({ deps, input })
 * 作用：创建并启动 Run（后台执行，多轮 turn；事件落到 run_events）
 * 约束：同一 draft 同时只允许一个 running Run；幂等仅在 client 提供 requestId 时生效
 * 参数：
 *  - deps: { draftRepo, chatRepo, runRepo, runEventRepo, runLogRepo, idempotencyStore }
 *  - input: object（draftId/baseVersion/requestId?/mode/reason/userText/preset/ctx/upstream/providerOptions/runOptions/model）
 * 返回：Promise<{ runId, draftId, baseVersion, version, status }>
 */
export async function startVcardRunInteractor({ deps, input }) {
  const { draftRepo, chatRepo, runRepo, runEventRepo, runLogRepo, pendingRepo, idempotencyStore, presetRepo, settingsRepo } = assertRunDeps(deps);
  const normalized = normalizeRunStartInput(input);

  const cached = await tryReadStartIdempotency(idempotencyStore, normalized);
  if (cached) return cached;

  await ensureDraftVersion(draftRepo, normalized);

  const reused = await ensureNoOtherRunningRun(runRepo, normalized);
  if (reused) return reused;

  const { run, result } = await createRunWithIdempotency({ runRepo, idempotencyStore, normalized });

  startVcardRunInBackground({
    deps: { draftRepo, chatRepo, runRepo, runEventRepo, runLogRepo, pendingRepo, idempotencyStore, presetRepo, settingsRepo },
    run,
    input: {
      mode: normalized.requestedMode,
      reason: normalized.reason,
      userText: normalized.userText,
      presetName: normalized.presetName,
      preset: normalized.preset,
      ctx: normalized.ctx,
      upstream: normalized.upstream,
      providerOptions: normalized.providerOptions,
      runOptions: normalized.runOptions,
      model: normalized.model,
    },
  });

  return result;
}

/**
 * 中文注释：
 * getVcardRunInteractor({ deps, runId })
 * 作用：查询 Run 状态（running/stopped + stopReason/turns/version）
 * 参数：
 *  - deps: { runRepo }
 *  - runId: string
 * 返回：Promise<{ runId, draftId, status, stopReason?, stopMessage?, turns, version }>
 */
export async function getVcardRunInteractor({ deps, runId }) {
  const { runRepo } = assertRunDeps(deps);
  const id = normalizeText(runId);
  const run = await runRepo.getRun({ runId: id });
  if (!run) throw new ApiError({ httpStatus: 404, code: ERROR_CODES.RUN_NOT_FOUND, message: "Run 不存在。" });

  return {
    runId: run.runId,
    draftId: run.draftId,
    status: run.status,
    stopReason: run.stopReason || undefined,
    stopMessage: run.stopMessage || undefined,
    turns: run.turns,
    version: run.version,
  };
}

/**
 * 中文注释：
 * cancelVcardRunInteractor({ deps, runId })
 * 作用：停止 Run（标记 stopReason=canceled；尝试立即 abort 当前 in-flight）
 * 参数：
 *  - deps: { runRepo }
 *  - runId: string
 * 返回：Promise<{ runId, status, stopReason }>
 */
export async function cancelVcardRunInteractor({ deps, runId }) {
  const { runRepo } = assertRunDeps(deps);
  const id = normalizeText(runId);
  const run = await runRepo.getRun({ runId: id });
  if (!run) throw new ApiError({ httpStatus: 404, code: ERROR_CODES.RUN_NOT_FOUND, message: "Run 不存在。" });
  if (run.status === RUN_STATUS.STOPPED) return { runId: run.runId, status: run.status, stopReason: run.stopReason || RUN_STOP_REASONS.CANCELED };

  await runRepo.stopRun({ runId: run.runId, stopReason: RUN_STOP_REASONS.CANCELED, stopMessage: "用户取消。", turns: run.turns, version: run.version });
  abortRunById(run.runId);
  return { runId: run.runId, status: RUN_STATUS.STOPPED, stopReason: RUN_STOP_REASONS.CANCELED };
}

/**
 * 中文注释：
 * getVcardRunResultInteractor({ deps, runId })
 * 作用：读取 Run 结果（Run 未停止则返回 RUN_NOT_STOPPED）
 * 参数：
 *  - deps: { runRepo, draftRepo }
 *  - runId: string
 * 返回：Promise<{ runId, draftId, version, snapshot, stopReason, stopMessage?, turns? }>
 */
export async function getVcardRunResultInteractor({ deps, runId }) {
  const { runRepo, draftRepo, runEventRepo } = assertRunDeps(deps);
  const id = normalizeText(runId);
  const run = await runRepo.getRun({ runId: id });
  if (!run) throw new ApiError({ httpStatus: 404, code: ERROR_CODES.RUN_NOT_FOUND, message: "Run 不存在。" });
  if (run.status !== RUN_STATUS.STOPPED) throw new ApiError({ httpStatus: 409, code: ERROR_CODES.RUN_NOT_STOPPED, message: "Run 仍在运行，请稍后再试。" });

  const finalEvent = await runEventRepo.getLatestEventByType({ runId: run.runId, type: "final" }).catch(() => null);
  if (finalEvent?.data?.ok === true) return finalEvent.data;

  const draft = await draftRepo.getDraft({ draftId: run.draftId }).catch(() => null);
  const snapshot = draft?.snapshot ?? {};

  return {
    runId: run.runId,
    draftId: run.draftId,
    version: run.version,
    snapshot,
    stopReason: run.stopReason || RUN_STOP_REASONS.ERROR,
    stopMessage: run.stopMessage || undefined,
    turns: run.turns,
  };
}
