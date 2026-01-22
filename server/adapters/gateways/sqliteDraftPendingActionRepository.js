/**
 * 文件：sqliteDraftPendingActionRepository.js
 * 模块：server/adapters/gateways
 * 作用：DraftPendingAction 仓储（SQLite：draft_pending_actions；存放待审批 plan/patch 提案）
 * 依赖：server/shared/apiError、server/shared/errorCodes
 * @created 2026-01-17
 * @modified 2026-01-17
 */

import { ApiError } from "../../shared/apiError.js";
import { ERROR_CODES } from "../../shared/errorCodes.js";

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return String(value ?? "").trim();
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

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

function toPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

function mapRow(row) {
  if (!row) return null;
  return {
    draftId: normalizeText(row.draft_id),
    kind: normalizeText(row.kind),
    baseVersion: toIntStrict(row.base_version) ?? 0,
    fpBefore: normalizeText(row.fp_before),
    payload: safeJsonParse(row.payload_json) ?? null,
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
  };
}

/**
 * 中文注释：
 * createSqliteDraftPendingActionRepository(db)
 * 作用：创建 DraftPendingActionRepository（SQLite 实现：draft_pending_actions）
 * 约束：draftId 为主键（一草稿最多一个 pending）；payload_json 必须可 JSON.stringify
 * 参数：
 *  - db: any（openSqliteDb 返回值）
 * 返回：{ getPending, upsertPending, deletePending }
 */
export function createSqliteDraftPendingActionRepository(db) {
  if (!db) throw new Error("db 不能为空。");

  const getPending = async ({ draftId }) => {
    const id = normalizeText(draftId);
    if (!id) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "draftId 不能为空。" });

    const row = await db.get(
      "SELECT draft_id, kind, base_version, fp_before, payload_json, created_at, updated_at FROM draft_pending_actions WHERE draft_id = ?",
      [id],
    );
    const mapped = mapRow(row);
    if (!mapped) return null;
    return mapped;
  };

  const upsertPending = async ({ draftId, kind, baseVersion, fpBefore, payload }) => {
    const id = normalizeText(draftId);
    if (!id) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "draftId 不能为空。" });

    const k = normalizeText(kind);
    if (!k) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "kind 不能为空。" });

    const base = toIntStrict(baseVersion);
    if (base === null || base < 1) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "baseVersion 非法。" });

    const fp = normalizeText(fpBefore);
    if (!fp) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "fpBefore 不能为空。" });

    const obj = payload === null || payload === undefined ? null : toPlainObject(payload) || payload;
    const json = safeJsonStringify(obj);
    const at = nowIso();

    await db.run(
      `
        INSERT INTO draft_pending_actions (draft_id, kind, base_version, fp_before, payload_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(draft_id) DO UPDATE SET
          kind = excluded.kind,
          base_version = excluded.base_version,
          fp_before = excluded.fp_before,
          payload_json = excluded.payload_json,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `,
      [id, k, base, fp, json, at, at],
    );

    return await getPending({ draftId: id });
  };

  const deletePending = async ({ draftId }) => {
    const id = normalizeText(draftId);
    if (!id) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "draftId 不能为空。" });

    const r = await db.run("DELETE FROM draft_pending_actions WHERE draft_id = ?", [id]);
    return { deleted: Number(r?.changes || 0) };
  };

  return { getPending, upsertPending, deletePending };
}

