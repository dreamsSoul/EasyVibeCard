/**
 * 文件：sqliteDraftRollback.js
 * 模块：server/adapters/gateways
 * 作用：Draft Rollback（SQLite：生成新版本，快照回到 toVersion；不删除 chat/run 数据）
 * 依赖：server/shared/apiError、server/shared/errorCodes
 * @created 2026-01-08
 * @modified 2026-01-08
 */

import { ApiError } from "../../shared/apiError.js";
import { ERROR_CODES } from "../../shared/errorCodes.js";

const IDEMPOTENCY_KIND_DRAFT_ROLLBACK = "draft_rollback";

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
  const row = await tx.get("SELECT head_version, max_version, chat_head_seq FROM drafts WHERE draft_id = ?", [draftId]);
  if (!row) return null;
  return {
    headVersion: toIntStrict(row.head_version) ?? 0,
    maxVersion: toIntStrict(row.max_version) ?? 0,
    chatHeadSeq: toIntStrict(row.chat_head_seq) ?? 0,
  };
}

async function assertNoRunningRun(tx, draftId) {
  const row = await tx.get("SELECT id FROM runs WHERE draft_id = ? AND status = 'running' LIMIT 1", [draftId]);
  if (!row?.id) return;
  throw new ApiError({
    httpStatus: 409,
    code: ERROR_CODES.DRAFT_BUSY,
    message: "草稿存在进行中的 Run，请先停止 Run 再 rollback。",
    details: { runId: String(row.id) },
  });
}

async function readSnapshotByVersion(tx, { draftId, toVersion }) {
  const row = await tx.get("SELECT snapshot_json FROM draft_versions WHERE draft_id = ? AND version = ?", [draftId, toVersion]);
  const snapshot = toPlainObject(safeJsonParse(row?.snapshot_json));
  return snapshot;
}

function normalizeRollbackInput({ draftId, baseVersion, requestId, toVersion }) {
  const id = String(draftId || "").trim();
  const base = toIntStrict(baseVersion);
  const toV = toIntStrict(toVersion);
  const reqId = String(requestId || "").trim() || "";
  return { draftId: id, baseVersion: base, requestId: reqId, toVersion: toV };
}

function assertRollbackInputBasics(input) {
  if (!input.draftId) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "draftId 不能为空。" });
  if (input.baseVersion === null || input.baseVersion < 1) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "baseVersion 非法。" });
  if (input.toVersion === null || input.toVersion < 1) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "toVersion 非法。" });
}

async function readRollbackIdempotency(idempotency, input) {
  if (!input.requestId) return null;
  return await idempotency.get({ draftId: input.draftId, requestId: input.requestId, kind: IDEMPOTENCY_KIND_DRAFT_ROLLBACK });
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

async function persistRollback(tx, { draftId, nextVersion, snapshot, metaJson }) {
  const at = nowIso();
  await tx.run(
    "INSERT INTO draft_versions (draft_id, version, snapshot_json, meta_json, is_archived, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [draftId, nextVersion, JSON.stringify(snapshot), JSON.stringify(metaJson), 0, at],
  );
  await tx.run("UPDATE drafts SET head_version = ?, max_version = ?, updated_at = ? WHERE draft_id = ?", [nextVersion, nextVersion, at, draftId]);
  return at;
}

/**
 * 中文注释：
 * createSqliteDraftRollbacker({ db, idempotency })
 * 作用：创建 rollbackDraft（生成新版本，快照回到 toVersion；不删除 chat/run 数据）
 * 约束：baseVersion 必须等于 headVersion；toVersion 必须存在；存在 running Run 时返回 DRAFT_BUSY
 * 参数：
 *  - db: any（openSqliteDb 返回值）
 *  - idempotency: { get, setIfAbsent }（SQLite 幂等键）
 * 返回：({ draftId, baseVersion, requestId, toVersion }) => Promise<{ ... }>
 */
export function createSqliteDraftRollbacker({ db, idempotency }) {
  if (!db) throw new Error("db 不能为空。");
  if (!idempotency?.get || !idempotency?.setIfAbsent) throw new Error("idempotency 未就绪。");

  return async ({ draftId, baseVersion, requestId, toVersion }) => {
    const input = normalizeRollbackInput({ draftId, baseVersion, requestId, toVersion });
    assertRollbackInputBasics(input);

    return await db.transaction(async () => {
      const existed = await readRollbackIdempotency(idempotency, input);
      if (existed) return existed;

      const meta = await loadAndAssertMeta(db, input);
      await assertNoRunningRun(db, input.draftId);

      const snapshot = await readSnapshotByVersion(db, { draftId: input.draftId, toVersion: input.toVersion });
      if (!snapshot) throw new ApiError({ httpStatus: 404, code: ERROR_CODES.VERSION_NOT_FOUND, message: "toVersion 不存在。" });

      const nextVersion = meta.maxVersion + 1;
      const metaJson = {
        source: "rollback",
        requestId: input.requestId || undefined,
        baseVersion: input.baseVersion,
        toVersion: input.toVersion,
        chatHeadSeq: meta.chatHeadSeq,
      };

      await persistRollback(db, { draftId: input.draftId, nextVersion, snapshot, metaJson });

      const result = {
        draftId: input.draftId,
        requestId: input.requestId || undefined,
        baseVersion: input.baseVersion,
        version: nextVersion,
        toVersion: input.toVersion,
        snapshot,
      };

      await idempotency.setIfAbsent({ draftId: input.draftId, requestId: input.requestId, kind: IDEMPOTENCY_KIND_DRAFT_ROLLBACK, result });
      return result;
    });
  };
}

