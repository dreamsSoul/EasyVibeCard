/**
 * 文件：sqliteDraftReset.js
 * 模块：server/adapters/gateways
 * 作用：Draft Reset（SQLite：截断未来 chat/run 数据，不产生新版本）
 * 依赖：server/shared/apiError、server/shared/errorCodes
 * @created 2026-01-08
 * @modified 2026-01-08
 */

import { ApiError } from "../../shared/apiError.js";
import { ERROR_CODES } from "../../shared/errorCodes.js";

const IDEMPOTENCY_KIND_DRAFT_RESET = "draft_reset";

function nowIso() {
  return new Date().toISOString();
}

function toPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

function toIntStrict(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function safeJsonParse(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
}

async function readDraftMeta(tx, draftId) {
  const row = await tx.get("SELECT head_version FROM drafts WHERE draft_id = ?", [draftId]);
  if (!row) return null;
  return { headVersion: toIntStrict(row.head_version) ?? 0 };
}

async function assertNoRunningRun(tx, draftId) {
  const row = await tx.get("SELECT id FROM runs WHERE draft_id = ? AND status = 'running' LIMIT 1", [draftId]);
  if (!row?.id) return;
  throw new ApiError({
    httpStatus: 409,
    code: ERROR_CODES.DRAFT_BUSY,
    message: "草稿存在进行中的 Run，请先停止 Run 再 reset。",
    details: { runId: String(row.id) },
  });
}

async function readVersionRow(tx, { draftId, toVersion }) {
  const row = await tx.get("SELECT snapshot_json, meta_json, created_at FROM draft_versions WHERE draft_id = ? AND version = ?", [draftId, toVersion]);
  if (!row) return null;
  return {
    snapshot: toPlainObject(safeJsonParse(row.snapshot_json)),
    meta: toPlainObject(safeJsonParse(row.meta_json)) || {},
    createdAt: String(row.created_at || ""),
  };
}

function pickChatHeadSeq(meta) {
  const n = toIntStrict(meta?.chatHeadSeq);
  return n === null || n < 0 ? 0 : n;
}

async function deleteChatMessagesAfter(tx, { draftId, chatHeadSeq }) {
  const deleted = await tx.run("DELETE FROM chat_messages WHERE draft_id = ? AND seq > ?", [draftId, chatHeadSeq]);
  return deleted.changes ?? 0;
}

async function deleteFutureRunEvents(tx, { draftId, cutoffCreatedAt }) {
  const deleted = await tx.run(
    `
      DELETE FROM run_events
      WHERE run_id IN (SELECT id FROM runs WHERE draft_id = ? AND created_at > ?)
         OR (created_at > ? AND run_id IN (SELECT id FROM runs WHERE draft_id = ?))
    `,
    [draftId, cutoffCreatedAt, cutoffCreatedAt, draftId],
  );
  return deleted.changes ?? 0;
}

async function deleteFutureRunLogs(tx, { draftId, cutoffCreatedAt }) {
  const deleted = await tx.run("DELETE FROM run_logs WHERE draft_id = ? AND created_at > ?", [draftId, cutoffCreatedAt]);
  return deleted.changes ?? 0;
}

async function deleteFutureRuns(tx, { draftId, cutoffCreatedAt }) {
  const deleted = await tx.run("DELETE FROM runs WHERE draft_id = ? AND created_at > ?", [draftId, cutoffCreatedAt]);
  return deleted.changes ?? 0;
}

async function deleteFutureIdempotencyKeys(tx, { draftId, cutoffCreatedAt }) {
  await tx.run("DELETE FROM idempotency_keys WHERE draft_id = ? AND created_at > ?", [draftId, cutoffCreatedAt]);
}

async function archiveVersionsAfter(tx, { draftId, toVersion }) {
  await tx.run("UPDATE draft_versions SET is_archived = CASE WHEN version > ? THEN 1 ELSE 0 END WHERE draft_id = ?", [toVersion, draftId]);
}

async function updateDraftHead(tx, { draftId, toVersion, chatHeadSeq }) {
  const at = nowIso();
  await tx.run("UPDATE drafts SET head_version = ?, chat_head_seq = ?, updated_at = ? WHERE draft_id = ?", [toVersion, chatHeadSeq, at, draftId]);
}

function normalizeResetInput({ draftId, baseVersion, requestId, toVersion, confirm }) {
  const id = String(draftId || "").trim();
  const base = toIntStrict(baseVersion);
  const toV = toIntStrict(toVersion);
  const reqId = String(requestId || "").trim() || "";
  const confirmText = String(confirm || "").trim();

  return { draftId: id, baseVersion: base, requestId: reqId, toVersion: toV, confirm: confirmText };
}

function assertResetInputBasics(input) {
  if (!input.draftId) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "draftId 不能为空。" });
  if (input.baseVersion === null || input.baseVersion < 1) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "baseVersion 非法。" });
  if (input.toVersion === null || input.toVersion < 1) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "toVersion 非法。" });
  if (input.confirm !== "DELETE_FUTURE") {
    throw new ApiError({ httpStatus: 400, code: ERROR_CODES.RESET_CONFIRM_REQUIRED, message: "confirm 必须精确等于 DELETE_FUTURE。" });
  }
}

async function readResetIdempotency(idempotency, input) {
  if (!input.requestId) return null;
  return await idempotency.get({ draftId: input.draftId, requestId: input.requestId, kind: IDEMPOTENCY_KIND_DRAFT_RESET });
}

async function loadAndAssertMeta(db, input) {
  const meta = await readDraftMeta(db, input.draftId);
  if (!meta) throw new ApiError({ httpStatus: 404, code: ERROR_CODES.DRAFT_NOT_FOUND, message: "草稿不存在。" });
  if (input.baseVersion !== meta.headVersion) {
    throw new ApiError({
      httpStatus: 409,
      code: ERROR_CODES.VERSION_CONFLICT,
      message: "baseVersion 与 latestVersion 不一致。",
      details: { baseVersion: input.baseVersion, latestVersion: meta.headVersion },
    });
  }
  if (input.toVersion > meta.headVersion) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "toVersion 不能大于 baseVersion。" });
  return meta;
}

async function executeResetDeletes(db, input, v) {
  const chatHeadSeq = pickChatHeadSeq(v.meta);
  const chatMessages = await deleteChatMessagesAfter(db, { draftId: input.draftId, chatHeadSeq });
  const runEvents = await deleteFutureRunEvents(db, { draftId: input.draftId, cutoffCreatedAt: v.createdAt });
  const runLogs = await deleteFutureRunLogs(db, { draftId: input.draftId, cutoffCreatedAt: v.createdAt });
  const runs = await deleteFutureRuns(db, { draftId: input.draftId, cutoffCreatedAt: v.createdAt });
  await deleteFutureIdempotencyKeys(db, { draftId: input.draftId, cutoffCreatedAt: v.createdAt });
  return { chatHeadSeq, deleted: { chatMessages, runs, runEvents, runLogs } };
}

async function persistResetHead(db, input, chatHeadSeq) {
  await archiveVersionsAfter(db, { draftId: input.draftId, toVersion: input.toVersion });
  await updateDraftHead(db, { draftId: input.draftId, toVersion: input.toVersion, chatHeadSeq });
}

/**
 * 中文注释：
 * createSqliteDraftResetter({ db, idempotency })
 * 作用：创建 resetDraft（危险操作：截断未来 chat/run 数据，不产生新版本）
 * 约束：confirm 必须为 DELETE_FUTURE；存在 running Run 时返回 DRAFT_BUSY
 * 参数：
 *  - db: any（openSqliteDb 返回值）
 *  - idempotency: { get, setIfAbsent }（SQLite 幂等键）
 * 返回：({ draftId, baseVersion, requestId, toVersion, confirm }) => Promise<{ ... }>
 */
export function createSqliteDraftResetter({ db, idempotency }) {
  if (!db) throw new Error("db 不能为空。");
  if (!idempotency?.get || !idempotency?.setIfAbsent) throw new Error("idempotency 未就绪。");

  return async ({ draftId, baseVersion, requestId, toVersion, confirm }) => {
    const input = normalizeResetInput({ draftId, baseVersion, requestId, toVersion, confirm });
    assertResetInputBasics(input);

    return await db.transaction(async () => {
      const existed = await readResetIdempotency(idempotency, input);
      if (existed) return existed;

      await loadAndAssertMeta(db, input);

      await assertNoRunningRun(db, input.draftId);

      const v = await readVersionRow(db, { draftId: input.draftId, toVersion: input.toVersion });
      if (!v?.snapshot) throw new ApiError({ httpStatus: 404, code: ERROR_CODES.VERSION_NOT_FOUND, message: "toVersion 不存在。" });

      const { chatHeadSeq, deleted } = await executeResetDeletes(db, input, v);
      await persistResetHead(db, input, chatHeadSeq);

      const result = {
        draftId: input.draftId,
        requestId: input.requestId || undefined,
        baseVersion: input.baseVersion,
        version: input.toVersion,
        toVersion: input.toVersion,
        deleted,
        snapshot: v.snapshot,
      };

      await idempotency.setIfAbsent({ draftId: input.draftId, requestId: input.requestId, kind: IDEMPOTENCY_KIND_DRAFT_RESET, result });
      return result;
    });
  };
}
