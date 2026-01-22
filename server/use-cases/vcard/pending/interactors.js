/**
 * 文件：interactors.js
 * 模块：server/use-cases/vcard/pending
 * 作用：VCard pending 用例（查询 pending、Plan approve/reject、Patch accept/reject）
 * 依赖：server/shared/apiError、server/shared/errorCodes、server/entities/draftFingerprint、server/entities/vcard/vibePlan
 * @created 2026-01-17
 * @modified 2026-01-17
 */

import { ApiError } from "../../../shared/apiError.js";
import { ERROR_CODES } from "../../../shared/errorCodes.js";

import { fingerprintDraftSnapshot } from "../../../entities/draftFingerprint.js";
import { normalizeVibePlan } from "../../../entities/vcard/vibePlan.js";

function normalizeText(value) {
  return String(value ?? "").trim();
}

function toIntStrict(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

async function assertDraftNotBusy(runRepo, draftId) {
  if (!runRepo?.findRunningByDraftId) return;
  const running = await runRepo.findRunningByDraftId({ draftId });
  if (!running?.runId) return;
  throw new ApiError({
    httpStatus: 409,
    code: ERROR_CODES.DRAFT_BUSY,
    message: "草稿存在进行中的 Run，请先停止 Run 再操作。",
    details: { runId: running.runId },
  });
}

async function loadSnapshotOrThrow(draftRepo, { draftId, baseVersion }) {
  if (!draftRepo?.getDraftMeta || !draftRepo?.getDraft) throw new Error("draftRepo 未就绪。");
  const id = normalizeText(draftId);
  const base = toIntStrict(baseVersion);
  if (!id) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "draftId 不能为空。" });
  if (base === null || base < 1) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "baseVersion 非法。" });

  const meta = await draftRepo.getDraftMeta({ draftId: id });
  if (!meta) throw new ApiError({ httpStatus: 404, code: ERROR_CODES.DRAFT_NOT_FOUND, message: "草稿不存在。" });
  if (meta.headVersion !== base) {
    throw new ApiError({
      httpStatus: 409,
      code: ERROR_CODES.VERSION_CONFLICT,
      message: "baseVersion 与 latestVersion 不一致。",
      details: { baseVersion: base, latestVersion: meta.headVersion },
    });
  }

  const current = await draftRepo.getDraft({ draftId: id });
  if (!current?.snapshot) throw new Error("草稿快照缺失。");
  return { snapshot: current.snapshot, draftId: id, baseVersion: base };
}

async function loadPendingOrThrow(pendingRepo, { draftId }) {
  if (!pendingRepo?.getPending) throw new Error("pendingRepo.getPending 缺失。");
  const id = normalizeText(draftId);
  if (!id) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "draftId 不能为空。" });
  const pending = await pendingRepo.getPending({ draftId: id });
  if (!pending) throw new ApiError({ httpStatus: 404, code: ERROR_CODES.PENDING_NOT_FOUND, message: "当前草稿不存在待审批项。" });
  return pending;
}

function assertPendingKind(pending, expectedKind) {
  const got = normalizeText(pending?.kind);
  const exp = normalizeText(expectedKind);
  if (got === exp) return;
  throw new ApiError({
    httpStatus: 409,
    code: ERROR_CODES.PENDING_KIND_MISMATCH,
    message: `待审批项类型不匹配（expected=${exp || "（空）"}, got=${got || "（空）"}）。`,
    details: { expectedKind: exp, gotKind: got },
  });
}

function assertFpBefore({ inputFpBefore, pendingFpBefore, snapshot }) {
  const input = normalizeText(inputFpBefore);
  const pending = normalizeText(pendingFpBefore);
  if (!input) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "fpBefore 不能为空。" });
  if (!pending) throw new ApiError({ httpStatus: 500, code: ERROR_CODES.INTERNAL_ERROR, message: "pending.fpBefore 缺失（数据不一致）。" });
  if (input !== pending) {
    throw new ApiError({
      httpStatus: 409,
      code: ERROR_CODES.DRAFT_CHANGED,
      message: "草稿已变化（fpBefore 不一致）。",
      details: { fpBefore: input, pendingFpBefore: pending },
    });
  }

  const actual = fingerprintDraftSnapshot(snapshot);
  if (actual !== pending) {
    throw new ApiError({
      httpStatus: 409,
      code: ERROR_CODES.DRAFT_CHANGED,
      message: "草稿已变化（指纹校验失败）。",
      details: { fpBefore: pending, actualFp: actual },
    });
  }
}

function pickPayload(pending) {
  const p = pending?.payload;
  if (p === null || p === undefined) return null;
  return p;
}

/**
 * 中文注释：
 * getVcardPendingInteractor({ draftRepo, pendingRepo, draftId })
 * 作用：查询草稿 pending（若 pending 与 headVersion 不一致会自动清理）
 * 约束：返回 { pending:null | {...} }
 * 返回：Promise<{ pending: any|null }>
 */
export async function getVcardPendingInteractor({ draftRepo, pendingRepo, draftId }) {
  if (!pendingRepo?.getPending || !pendingRepo?.deletePending) throw new Error("pendingRepo 未就绪。");
  const id = normalizeText(draftId);
  if (!id) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "draftId 不能为空。" });

  const pending = await pendingRepo.getPending({ draftId: id });
  if (!pending) return { pending: null };

  // 自愈：pending.baseVersion 与当前 headVersion 不一致时认为是陈旧 pending，清理后返回 null。
  const meta = await draftRepo.getDraftMeta({ draftId: id }).catch(() => null);
  const head = toIntStrict(meta?.headVersion) ?? null;
  if (head && Number(pending.baseVersion) !== head) {
    await pendingRepo.deletePending({ draftId: id }).catch(() => undefined);
    return { pending: null };
  }

  const payload = pickPayload(pending);
  return {
    pending: {
      kind: pending.kind,
      draftId: pending.draftId,
      baseVersion: pending.baseVersion,
      fpBefore: pending.fpBefore,
      createdAt: pending.createdAt,
      updatedAt: pending.updatedAt,
      pendingPlan: pending.kind === "plan_review" ? (payload && isPlainObject(payload) ? payload : null) : undefined,
      pendingReview: pending.kind === "patch_review" ? (payload && isPlainObject(payload) ? payload : null) : undefined,
    },
  };
}

/**
 * 中文注释：
 * approveVcardPendingPlanInteractor({ draftRepo, runRepo, pendingRepo, draftId, baseVersion, fpBefore, editedPlan, requestId })
 * 作用：批准 plan_review：写入 raw.dataExtensions.vibePlan 并产生新版本，然后清理 pending
 * 约束：必须通过 baseVersion + fpBefore 乐观锁校验；存在 running Run 时返回 DRAFT_BUSY
 */
export async function approveVcardPendingPlanInteractor({ draftRepo, runRepo, pendingRepo, draftId, baseVersion, fpBefore, editedPlan, requestId }) {
  await assertDraftNotBusy(runRepo, draftId);
  const pending = await loadPendingOrThrow(pendingRepo, { draftId });
  assertPendingKind(pending, "plan_review");

  const base = toIntStrict(baseVersion);
  if (base === null || base < 1) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "baseVersion 非法。" });
  if (Number(pending.baseVersion) !== base) {
    throw new ApiError({
      httpStatus: 409,
      code: ERROR_CODES.VERSION_CONFLICT,
      message: "baseVersion 与 pending.baseVersion 不一致。",
      details: { baseVersion: base, pendingBaseVersion: pending.baseVersion },
    });
  }

  const loaded = await loadSnapshotOrThrow(draftRepo, { draftId, baseVersion: base });
  assertFpBefore({ inputFpBefore: fpBefore, pendingFpBefore: pending.fpBefore, snapshot: loaded.snapshot });

  const payload = pickPayload(pending);
  const planRaw = editedPlan !== undefined ? editedPlan : payload?.plan;
  if (!planRaw || typeof planRaw !== "object") {
    throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "pendingPlan.plan 缺失或非法。" });
  }
  const plan = normalizeVibePlan(planRaw);

  const applied = await draftRepo.applyDraftPatch({
    draftId: loaded.draftId,
    baseVersion: loaded.baseVersion,
    requestId: normalizeText(requestId) || undefined,
    mode: "auto",
    patchOps: [{ op: "set", path: "raw.dataExtensions.vibePlan", value: plan }],
    meta: { source: "vcard-pending-plan-approve" },
  });

  await pendingRepo.deletePending({ draftId: loaded.draftId }).catch(() => undefined);
  return applied;
}

/**
 * 中文注释：
 * rejectVcardPendingPlanInteractor({ draftRepo, runRepo, pendingRepo, draftId, baseVersion, fpBefore })
 * 作用：驳回 plan_review：仅清理 pending，不修改草稿版本
 * 约束：必须通过 baseVersion + fpBefore 乐观锁校验；存在 running Run 时返回 DRAFT_BUSY
 */
export async function rejectVcardPendingPlanInteractor({ draftRepo, runRepo, pendingRepo, draftId, baseVersion, fpBefore }) {
  await assertDraftNotBusy(runRepo, draftId);
  const pending = await loadPendingOrThrow(pendingRepo, { draftId });
  assertPendingKind(pending, "plan_review");

  const loaded = await loadSnapshotOrThrow(draftRepo, { draftId, baseVersion });
  assertFpBefore({ inputFpBefore: fpBefore, pendingFpBefore: pending.fpBefore, snapshot: loaded.snapshot });

  await pendingRepo.deletePending({ draftId: loaded.draftId });
  return {};
}

/**
 * 中文注释：
 * acceptVcardPendingPatchInteractor({ draftRepo, runRepo, pendingRepo, draftId, baseVersion, fpBefore, requestId })
 * 作用：接受 patch_review：apply pending.patchOps 产生新版本，然后清理 pending
 * 约束：必须通过 baseVersion + fpBefore 乐观锁校验；存在 running Run 时返回 DRAFT_BUSY
 */
export async function acceptVcardPendingPatchInteractor({ draftRepo, runRepo, pendingRepo, draftId, baseVersion, fpBefore, requestId }) {
  await assertDraftNotBusy(runRepo, draftId);
  const pending = await loadPendingOrThrow(pendingRepo, { draftId });
  assertPendingKind(pending, "patch_review");

  const loaded = await loadSnapshotOrThrow(draftRepo, { draftId, baseVersion });
  assertFpBefore({ inputFpBefore: fpBefore, pendingFpBefore: pending.fpBefore, snapshot: loaded.snapshot });

  const payload = pickPayload(pending);
  const patchOps = Array.isArray(payload?.patchOps) ? payload.patchOps : null;
  if (!patchOps || patchOps.length === 0) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "pendingReview.patchOps 缺失或为空。" });

  const applied = await draftRepo.applyDraftPatch({
    draftId: loaded.draftId,
    baseVersion: loaded.baseVersion,
    requestId: normalizeText(requestId) || undefined,
    mode: "auto",
    patchOps,
    meta: { source: "vcard-pending-patch-accept" },
  });

  await pendingRepo.deletePending({ draftId: loaded.draftId }).catch(() => undefined);
  return applied;
}

/**
 * 中文注释：
 * rejectVcardPendingPatchInteractor({ draftRepo, runRepo, pendingRepo, draftId, baseVersion, fpBefore })
 * 作用：拒绝 patch_review：仅清理 pending，不修改草稿版本
 * 约束：必须通过 baseVersion + fpBefore 乐观锁校验；存在 running Run 时返回 DRAFT_BUSY
 */
export async function rejectVcardPendingPatchInteractor({ draftRepo, runRepo, pendingRepo, draftId, baseVersion, fpBefore }) {
  await assertDraftNotBusy(runRepo, draftId);
  const pending = await loadPendingOrThrow(pendingRepo, { draftId });
  assertPendingKind(pending, "patch_review");

  const loaded = await loadSnapshotOrThrow(draftRepo, { draftId, baseVersion });
  assertFpBefore({ inputFpBefore: fpBefore, pendingFpBefore: pending.fpBefore, snapshot: loaded.snapshot });

  await pendingRepo.deletePending({ draftId: loaded.draftId });
  return {};
}
