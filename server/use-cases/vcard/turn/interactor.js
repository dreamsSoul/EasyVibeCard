/**
 * 文件：interactor.js
 * 模块：server/use-cases/vcard/turn
 * 作用：VCard Turn 用例入口（协调：草稿读取、read-loop、apply、RunLog、幂等）
 * 依赖：server/use-cases/vcard/turn/*
 * @created 2026-01-07
 * @modified 2026-01-20
 */

import { ApiError } from "../../../shared/apiError.js";
import { ERROR_CODES } from "../../../shared/errorCodes.js";

import { IDEMPOTENCY_KIND_VCARD_TURN, MAX_WORLD_INFO_AFTER_APPEND_CHARS } from "./constants.js";
import { assertTurnDeps, writeFailureRunLog, writeSuccessRunLog } from "./deps.js";
import { toPatchOpsFromItems } from "./patchOpsFromItems.js";
import { runReadLoop } from "./readLoop.js";
import { maybeBuildReviewPause } from "./reviewPause.js";
import { buildDebugUpstream, buildVcardTurnMessages, ensureDraftAndVersion, normalizeTurnInput, resolveVcardTurnConfig } from "./state.js";
import { applyOutputCleaner } from "../../../entities/vcard/outputCleaner.js";

async function assertDraftNotBusy(runRepo, { draftId, runId }) {
  if (runId) return;
  if (!runRepo?.findRunningByDraftId) return;
  const running = await runRepo.findRunningByDraftId({ draftId });
  if (!running?.runId) return;
  throw new ApiError({
    httpStatus: 409,
    code: ERROR_CODES.DRAFT_BUSY,
    message: "草稿存在进行中的 Run，请先停止 Run 再运行 turn。",
    details: { runId: running.runId },
  });
}

async function assertDraftNotPending(pendingRepo, { draftId, baseVersion, runId }) {
  if (runId) return;
  if (!pendingRepo?.getPending || !pendingRepo?.deletePending) return;
  const pending = await pendingRepo.getPending({ draftId });
  if (!pending) return;

  // 自愈：pending.baseVersion 与当前 headVersion 不一致时认为是陈旧 pending，清理后允许继续 turn。
  const base = Number(baseVersion) || 0;
  if (base > 0 && Number(pending.baseVersion) !== base) {
    await pendingRepo.deletePending({ draftId }).catch(() => undefined);
    return;
  }

  throw new ApiError({
    httpStatus: 409,
    code: ERROR_CODES.DRAFT_PENDING,
    message: "草稿存在待审批项，请先处理后再继续。",
    details: { kind: pending.kind, baseVersion: pending.baseVersion },
  });
}

async function tryReadIdempotency(idempotencyStore, { draftId, clientRequestId }) {
  if (!clientRequestId) return null;
  return await idempotencyStore.get({ draftId, requestId: clientRequestId, kind: IDEMPOTENCY_KIND_VCARD_TURN });
}

async function writeIdempotencyIfNeeded(idempotencyStore, { draftId, clientRequestId, result }) {
  if (!clientRequestId) return;
  await idempotencyStore.setIfAbsent({ draftId, requestId: clientRequestId, kind: IDEMPOTENCY_KIND_VCARD_TURN, result });
}

async function applyPatchOpsIfAny(draftRepo, { draftId, baseVersion, requestId, mode, patchOps, meta, emit }) {
  const ops = Array.isArray(patchOps) ? patchOps : [];
  const allowEmptyPatch = Boolean(meta?.allowEmptyPatch);
  if (ops.length === 0 && !allowEmptyPatch) return null;

  const applied = await draftRepo.applyDraftPatch({ draftId, baseVersion, requestId, mode, patchOps: ops, meta });
  if (typeof emit === "function") {
    emit("applied", { requestId, draftId, version: applied.version, changedPaths: applied.changedPaths, warnings: [], errors: [] });
  }
  return applied;
}

function emitMeta(emit, payload) {
  if (typeof emit !== "function") return;
  emit("meta", payload);
}

function emitPatchOps(emit, payload) {
  if (typeof emit !== "function") return;
  emit("patch_ops", payload);
}

async function loadSnapshotAndMode(draftRepo, normalized) {
  const snapshot = await ensureDraftAndVersion(draftRepo, normalized.draftId, normalized.baseVersion);
  return { snapshot, mode: "auto" };
}

function emitTurnMeta(emit, { normalized, debugUpstream, upstreamStream, mode }) {
  emitMeta(emit, {
    requestId: normalized.requestId,
    draftId: normalized.draftId,
    baseVersion: normalized.baseVersion,
    mode,
    provider: debugUpstream.provider,
    stream: normalized.stream,
    upstreamStream,
    limits: { worldInfoAfterAppendMaxChars: MAX_WORLD_INFO_AFTER_APPEND_CHARS, maxReadsPerRound: 8 },
  });
}

async function buildTurnMessages(chatRepo, idempotencyStore, { normalized, snapshot, mode }) {
  return await buildVcardTurnMessages({
    chatRepo,
    idempotencyStore,
    normalized,
    snapshot,
    mode,
    preset: normalized.preset,
    ctx: normalized.ctx,
    providerOptions: normalized.providerOptions,
    vcard: normalized.vcard,
  });
}

function shouldWriteBackVcardOutputCleaner(vcard) {
  const cfg = vcard?.outputCleaner?.config;
  return Boolean(vcard?.outputCleaner?.writeBack && cfg && typeof cfg === "object" && cfg.enabled && Array.isArray(cfg.rules) && cfg.rules.length > 0);
}

async function runReadLoopAndPersistChat({ chatRepo, llmGateway, llmStreamGateway, normalized, snapshot, mode, messages, turnPrompt, emit }) {
  const loop = await runReadLoop({
    draftId: normalized.draftId,
    requestId: normalized.requestId,
    mode,
    snapshot,
    llmGateway,
    llmStreamGateway,
    ...normalized,
    messages,
    turnPrompt,
    emit,
  });
  const raw = String(loop.assistantText || "");
  const content = shouldWriteBackVcardOutputCleaner(normalized.vcard) ? applyOutputCleaner(raw, normalized.vcard.outputCleaner.config).text : raw;
  await chatRepo.appendChatMessage({ draftId: normalized.draftId, role: "assistant", content });
  return loop;
}

function computePatchOpsAndEmit(emit, { normalized, snapshot, loop }) {
  const { kinds, patchOps } = toPatchOpsFromItems(loop.finalItems, snapshot);
  emitPatchOps(emit, { requestId: normalized.requestId, draftId: normalized.draftId, kinds, patchOps });
  return { kinds, patchOps };
}

async function applyOpsAndPickResult({ draftRepo, normalized, mode, patchOps, meta, snapshot, emit }) {
  const applied = await applyPatchOpsIfAny(draftRepo, {
    draftId: normalized.draftId,
    baseVersion: normalized.baseVersion,
    requestId: normalized.requestId,
    mode,
    patchOps,
    meta,
    emit,
  });

  return {
    version: applied?.version ?? normalized.baseVersion,
    changedPaths: applied?.changedPaths ?? [],
    snapshot: applied?.snapshot ?? snapshot,
  };
}

async function writeSuccessLogAndBuildResult({ runLogRepo, normalized, mode, debugUpstream, upstreamStream, loop, kinds, applied }) {
  const runLog = await writeSuccessRunLog({
    runLogRepo,
    draftId: normalized.draftId,
    requestId: normalized.requestId,
    runId: normalized.runId || undefined,
    turnIndex: normalized.turnIndex || undefined,
    mode,
    reason: normalized.reason,
    baseVersion: normalized.baseVersion,
    version: applied.version,
    provider: debugUpstream.provider,
    stream: normalized.stream,
    upstreamStream,
    readRounds: loop.readRounds,
    kinds,
    changedPaths: applied.changedPaths,
    assistantText: loop.assistantText,
  });

  return {
    ok: true,
    requestId: normalized.requestId,
    draftId: normalized.draftId,
    baseVersion: normalized.baseVersion,
    version: applied.version,
    snapshot: applied.snapshot,
    runLog,
    debug: { upstream: debugUpstream, stage: "persist", providerDebug: loop.providerDebug },
  };
}

async function writeReviewPausedRunLog({ runLogRepo, normalized, mode, debugUpstream, upstreamStream, loop, kinds, proposedChangedPaths }) {
  return await runLogRepo.createRunLog({
    draftId: normalized.draftId,
    requestId: normalized.requestId,
    runId: normalized.runId || undefined,
    turnIndex: normalized.turnIndex || undefined,
    mode,
    reason: normalized.reason,
    baseVersion: normalized.baseVersion,
    version: null,
    ok: true,
    code: null,
    error: "",
    provider: debugUpstream.provider,
    stream: normalized.stream,
    upstreamStream,
    readRounds: loop.readRounds,
    kinds: Array.isArray(kinds) ? kinds : [],
    changedPaths: Array.isArray(proposedChangedPaths) ? proposedChangedPaths : [],
    assistantChars: String(loop.assistantText || "").length,
  });
}

async function runTurnCore({
  draftRepo,
  chatRepo,
  pendingRepo,
  runLogRepo,
  idempotencyStore,
  llmGateway,
  llmStreamGateway,
  presetRepo,
  settingsRepo,
  normalized,
  emit,
}) {
  const cached = await tryReadIdempotency(idempotencyStore, normalized);
  if (cached) return cached;

  await assertDraftNotBusy(normalized.runRepo, normalized);
  const upstreamStream = false;
  const source = normalized.runId ? "vcard-run" : "vcard-turn";

  const { snapshot, mode } = await loadSnapshotAndMode(draftRepo, normalized);
  await assertDraftNotPending(pendingRepo, { draftId: normalized.draftId, baseVersion: normalized.baseVersion, runId: normalized.runId });
  const resolved = await resolveVcardTurnConfig({ presetRepo, settingsRepo, normalized });
  const effective = {
    ...normalized,
    preset: resolved.preset,
    ctx: resolved.ctx,
    upstream: resolved.upstream,
    providerOptions: resolved.providerOptions,
    model: resolved.model,
    vcard: resolved.vcard,
  };
  const debugUpstream = buildDebugUpstream(effective.upstream);
  emitTurnMeta(emit, { normalized: effective, debugUpstream, upstreamStream, mode });

  const built = await buildTurnMessages(chatRepo, idempotencyStore, { normalized: effective, snapshot, mode });
  const loop = await runReadLoopAndPersistChat({
    chatRepo,
    llmGateway,
    llmStreamGateway,
    normalized: effective,
    snapshot,
    mode,
    messages: built.messages,
    turnPrompt: built.turnPrompt,
    emit,
  });

  const { kinds, patchOps } = computePatchOpsAndEmit(emit, { normalized: effective, snapshot, loop });

  const review = maybeBuildReviewPause({
    source,
    snapshot,
    kinds,
    patchOps,
    assistantWarnings: [],
  });
  if (review) {
    const pendingPayload = review.pendingPlan || review.pendingReview;
    if (pendingPayload && pendingRepo?.upsertPending) {
      await pendingRepo.upsertPending({
        draftId: effective.draftId,
        kind: review.pauseReason,
        baseVersion: effective.baseVersion,
        fpBefore: pendingPayload.fpBefore,
        payload: pendingPayload,
      });
    }

    const runLog = await writeReviewPausedRunLog({
      runLogRepo,
      normalized: effective,
      mode,
      debugUpstream,
      upstreamStream,
      loop,
      kinds,
      proposedChangedPaths: review.proposedChangedPaths,
    });

    const result = {
      ok: true,
      requestId: effective.requestId,
      draftId: effective.draftId,
      baseVersion: effective.baseVersion,
      version: effective.baseVersion,
      snapshot,
      changedPaths: [],
      paused: true,
      pauseReason: review.pauseReason,
      pendingPlan: review.pendingPlan,
      pendingReview: review.pendingReview,
      readRounds: loop.readRounds,
      readContinuation: null,
      runLog,
      debug: { upstream: debugUpstream, stage: "paused", providerDebug: loop.providerDebug },
    };

    await writeIdempotencyIfNeeded(idempotencyStore, { draftId: effective.draftId, clientRequestId: effective.clientRequestId, result });
    return result;
  }

  const applied = await applyOpsAndPickResult({
    draftRepo,
    normalized: effective,
    mode,
    patchOps,
    meta: {
      source,
      runId: effective.runId || undefined,
      turnIndex: effective.turnIndex || undefined,
      assistantKinds: kinds,
    },
    snapshot,
    emit,
  });

  const result = await writeSuccessLogAndBuildResult({ runLogRepo, normalized: effective, mode, debugUpstream, upstreamStream, loop, kinds, applied });

  await writeIdempotencyIfNeeded(idempotencyStore, { draftId: effective.draftId, clientRequestId: effective.clientRequestId, result });
  return result;
}

/**
 * 中文注释：
 * vcardTurnInteractor({ deps, input, emit })
 * 作用：执行 VCard 单轮 turn（非 Run），并在成功时写入 chat/runLog/版本
 * 约束：幂等仅在 client 提供 requestId 时生效；SSE 事件通过 emit 输出
 * 参数：
 *  - deps: { draftRepo, chatRepo, runRepo?, runLogRepo, idempotencyStore, llmGateway }
 *  - input: object（draftId/baseVersion/requestId/mode/reason/userText/preset/ctx/upstream/providerOptions/model）
 *  - emit?: (type:string, data:any)=>void
 * 返回：Promise<{ ok:true, requestId, draftId, baseVersion, version, snapshot, runLog, debug }>
 */
export async function vcardTurnInteractor({ deps, input, emit }) {
  const { draftRepo, chatRepo, runRepo, pendingRepo, runLogRepo, idempotencyStore, llmGateway, llmStreamGateway, presetRepo, settingsRepo } =
    assertTurnDeps(deps);
  const normalized = normalizeTurnInput(input);

  try {
    return await runTurnCore({
      draftRepo,
      chatRepo,
      pendingRepo,
      runLogRepo,
      idempotencyStore,
      llmGateway,
      llmStreamGateway,
      presetRepo,
      settingsRepo,
      normalized: { ...normalized, runRepo },
      emit,
    });
  } catch (err) {
    const code = String(err?.code || ERROR_CODES.INTERNAL_ERROR);
    const mode = "auto";
    const provider = String(normalized.upstream?.provider || "openai").trim() || "openai";
    await writeFailureRunLog({
      runLogRepo,
      draftId: normalized.draftId,
      requestId: normalized.requestId,
      runId: normalized.runId || undefined,
      turnIndex: normalized.turnIndex || undefined,
      mode,
      reason: normalized.reason,
      baseVersion: normalized.baseVersion,
      provider,
      stream: normalized.stream,
      upstreamStream: false,
      readRounds: 0,
      code,
      error: String(err?.message || err || "内部错误"),
    }).catch(() => undefined);
    throw err;
  }
}
