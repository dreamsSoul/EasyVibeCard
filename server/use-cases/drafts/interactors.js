/**
 * 文件：interactors.js
 * 模块：server/use-cases/drafts
 * 作用：Draft 用例（create/get/apply）
 * 依赖：server/shared/apiError、server/shared/errorCodes
 * @created 2026-01-07
 * @modified 2026-01-07
 */

import { ApiError } from "../../shared/apiError.js";
import { ERROR_CODES } from "../../shared/errorCodes.js";
import { toPatchOpsFromItems } from "../vcard/turn/patchOpsFromItems.js";

function toPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

function normalizeName(value) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  return s.slice(0, 200);
}

function toIntStrict(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
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

/**
 * 中文注释：
 * createDraftInteractor({ draftRepo, name })
 * 作用：创建草稿（version=1 + 初始快照）
 * 约束：name 为可选展示名；不影响 snapshot.card.name
 * 参数：
 *  - draftRepo: { createDraft }
 *  - name: string|undefined
 * 返回：Promise<{ draftId, version, snapshot }>
 */
export async function createDraftInteractor({ draftRepo, name }) {
  if (!draftRepo?.createDraft) throw new Error("draftRepo.createDraft 缺失。");
  return await draftRepo.createDraft({ name: normalizeName(name) });
}

/**
 * 中文注释：
 * getDraftInteractor({ draftRepo, draftId })
 * 作用：读取草稿 headVersion 快照
 * 约束：若不存在返回 null（由 Controller 决定 404）
 * 参数：
 *  - draftRepo: { getDraft }
 *  - draftId: string
 * 返回：Promise<{ draftId, version, snapshot }|null>
 */
export async function getDraftInteractor({ draftRepo, draftId }) {
  if (!draftRepo?.getDraft) throw new Error("draftRepo.getDraft 缺失。");
  return await draftRepo.getDraft({ draftId });
}

/**
 * 中文注释：
 * applyDraftPatchInteractor({ draftRepo, draftId, baseVersion, requestId, mode, patchOps })
 * 作用：应用 patchOps 并生成新版本
 * 约束：baseVersion 必须等于 headVersion；命中 requestId 幂等则返回历史结果
 * 参数：
 *  - draftRepo: { applyDraftPatch }
 *  - draftId: string
 *  - baseVersion: number
 *  - requestId: string|undefined
 *  - mode: "auto"|"plan"|"work"
 *  - patchOps: Array
 * 返回：Promise<{ draftId, requestId?, baseVersion, version, changedPaths, snapshot }>
 */
export async function applyDraftPatchInteractor({ draftRepo, runRepo, draftId, baseVersion, requestId, mode, patchOps }) {
  if (!draftRepo?.applyDraftPatch) throw new Error("draftRepo.applyDraftPatch 缺失。");
  const base = toIntStrict(baseVersion);
  if (base === null || base < 1) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "baseVersion 非法。" });
  if (!Array.isArray(patchOps) || patchOps.length === 0 || !toPlainObject(patchOps[0])) {
    throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "patchOps 不能为空。" });
  }
  await assertDraftNotBusy(runRepo, draftId);
  return await draftRepo.applyDraftPatch({ draftId, baseVersion: base, requestId, mode, patchOps });
}

/**
 * 中文注释：
 * applyDraftItemsInteractor({ draftRepo, runRepo, draftId, baseVersion, requestId, mode, items })
 * 作用：把 items 转换为 patchOps 并应用（用于前端编辑器提交 worldbook/regex/tavern_helper 等）
 * 约束：items 不能为空；baseVersion 必须等于 headVersion；存在 running Run 时返回 DRAFT_BUSY
 * 参数：
 *  - draftRepo: { getDraft, applyDraftPatch }
 *  - runRepo?: { findRunningByDraftId }
 * 返回：Promise<{ draftId, requestId?, baseVersion, version, changedPaths, snapshot }>
 */
export async function applyDraftItemsInteractor({ draftRepo, runRepo, draftId, baseVersion, requestId, mode, items }) {
  if (!draftRepo?.getDraft || !draftRepo?.applyDraftPatch) throw new Error("draftRepo 未就绪。");
  const base = toIntStrict(baseVersion);
  if (base === null || base < 1) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "baseVersion 非法。" });

  const list = Array.isArray(items) ? items : null;
  if (!list || list.length === 0) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "items 不能为空。" });

  await assertDraftNotBusy(runRepo, draftId);

  const current = await draftRepo.getDraft({ draftId });
  if (!current?.snapshot) throw new ApiError({ httpStatus: 404, code: ERROR_CODES.DRAFT_NOT_FOUND, message: "草稿不存在。" });
  if (current.version !== base) {
    throw new ApiError({
      httpStatus: 409,
      code: ERROR_CODES.VERSION_CONFLICT,
      message: "baseVersion 与 latestVersion 不一致。",
      details: { baseVersion: base, latestVersion: current.version },
    });
  }

  const { patchOps } = toPatchOpsFromItems(list, current.snapshot);
  if (!Array.isArray(patchOps) || patchOps.length === 0) {
    throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "items 未产生可应用的 patchOps。" });
  }

  return await draftRepo.applyDraftPatch({ draftId, baseVersion: base, requestId, mode, patchOps, meta: { source: "ui-apply-items" } });
}

/**
 * 中文注释：
 * resetDraftInteractor({ draftRepo, draftId, baseVersion, requestId, toVersion, confirm })
 * 作用：危险操作：将 headVersion 指回 toVersion，并删除未来 chat/run 数据（不产生新版本）
 * 约束：confirm 必须为 DELETE_FUTURE；baseVersion 必须等于 headVersion；存在 running Run 时返回 DRAFT_BUSY
 * 参数：
 *  - draftRepo: { resetDraft }
 *  - draftId: string
 *  - baseVersion: number
 *  - requestId: string|undefined
 *  - toVersion: number
 *  - confirm: string
 * 返回：Promise<{ draftId, requestId?, baseVersion, version, toVersion, deleted, snapshot }>
 */
export async function resetDraftInteractor({ draftRepo, draftId, baseVersion, requestId, toVersion, confirm }) {
  if (!draftRepo?.resetDraft) throw new Error("draftRepo.resetDraft 缺失。");
  const base = toIntStrict(baseVersion);
  if (base === null || base < 1) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "baseVersion 非法。" });
  const toV = toIntStrict(toVersion);
  if (toV === null || toV < 1) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "toVersion 非法。" });
  return await draftRepo.resetDraft({ draftId, baseVersion: base, requestId, toVersion: toV, confirm });
}

/**
 * 中文注释：
 * rollbackDraftInteractor({ draftRepo, draftId, baseVersion, requestId, toVersion })
 * 作用：回滚：生成新版本（快照回到 toVersion），不删除 chat/run 数据
 * 约束：baseVersion 必须等于 headVersion；toVersion 必须存在；存在 running Run 时返回 DRAFT_BUSY
 * 参数：
 *  - draftRepo: { rollbackDraft }
 *  - draftId: string
 *  - baseVersion: number
 *  - requestId: string|undefined
 *  - toVersion: number
 * 返回：Promise<{ draftId, requestId?, baseVersion, version, toVersion, snapshot }>
 */
export async function rollbackDraftInteractor({ draftRepo, draftId, baseVersion, requestId, toVersion }) {
  if (!draftRepo?.rollbackDraft) throw new Error("draftRepo.rollbackDraft 缺失。");
  const base = toIntStrict(baseVersion);
  if (base === null || base < 1) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "baseVersion 非法。" });
  const toV = toIntStrict(toVersion);
  if (toV === null || toV < 1) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "toVersion 非法。" });
  return await draftRepo.rollbackDraft({ draftId, baseVersion: base, requestId, toVersion: toV });
}
