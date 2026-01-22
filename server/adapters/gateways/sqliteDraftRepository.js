/**
 * 文件：sqliteDraftRepository.js
 * 模块：server/adapters/gateways
 * 作用：Draft 仓储（SQLite 实现：版本化快照 + 幂等键）
 * 依赖：server/entities、server/shared
 * @created 2026-01-07
 * @modified 2026-01-07
 */

import crypto from "node:crypto";

import { createEmptyDraftSnapshot } from "../../entities/draftSnapshot.js";
import { applyPatchOps } from "../../entities/patchOps.js";
import { lintCardDraft } from "../../entities/vcard/lint.js";
import { advanceVibePlanAfterAssistantApply } from "../../entities/vcard/vibePlanRuntime.js";
import { createSqliteDraftRollbacker } from "./sqliteDraftRollback.js";
import { createSqliteDraftResetter } from "./sqliteDraftReset.js";
import { createSqliteIdempotencyStore } from "./sqliteIdempotencyStore.js";
import { ApiError } from "../../shared/apiError.js";
import { ERROR_CODES } from "../../shared/errorCodes.js";

const IDEMPOTENCY_KIND_DRAFT_APPLY = "draft_apply";

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

function isArtifactPath(path) {
  const root = String(path || "").split(".")[0] || "";
  return root === "card" || root === "worldbook" || root === "regex_scripts" || root === "tavern_helper";
}

function postProcessSnapshot({ snapshot, changedPaths, meta }) {
  const changed = new Set(Array.isArray(changedPaths) ? changedPaths : []);
  const next = snapshot;

  const source = String(meta?.source || "");
  const shouldAdvanceVibePlan = source.startsWith("vcard");
  if (shouldAdvanceVibePlan && toPlainObject(next?.raw) && toPlainObject(next.raw.dataExtensions)) {
    const artifactChanged = Array.from(changed).some((p) => isArtifactPath(p));
    const advanced = advanceVibePlanAfterAssistantApply({ draft: next, artifactChanged });

    if (advanced?.advanced || advanced?.synced) changed.add("raw.dataExtensions.vibePlan");
  }

  const linted = lintCardDraft(next);
  if (toPlainObject(next.validation)) {
    next.validation.errors = linted.errors;
    next.validation.warnings = linted.warnings;
  } else {
    next.validation = { errors: linted.errors, warnings: linted.warnings };
  }

  if (!toPlainObject(next.meta)) next.meta = {};
  next.meta.progress = linted.progress;
  next.meta.updatedAt = nowIso();

  return { snapshot: next, changedPaths: Array.from(changed) };
}

async function readDraftMetaRow(tx, draftId) {
  const row = await tx.get("SELECT head_version, max_version, chat_head_seq FROM drafts WHERE draft_id = ?", [draftId]);
  if (!row) return null;
  return {
    headVersion: toIntStrict(row.head_version) ?? 0,
    maxVersion: toIntStrict(row.max_version) ?? 0,
    chatHeadSeq: toIntStrict(row.chat_head_seq) ?? 0,
  };
}

async function getSnapshotByVersion(tx, { draftId, version }) {
  const row = await tx.get("SELECT snapshot_json FROM draft_versions WHERE draft_id = ? AND version = ?", [draftId, version]);
  const parsed = (() => {
    try {
      return JSON.parse(String(row?.snapshot_json || ""));
    } catch {
      return null;
    }
  })();
  return toPlainObject(parsed);
}

/**
 * 中文注释：
 * createSqliteDraftRepository(db)
 * 作用：创建 DraftRepository（SQLite 实现）
 * 约束：db 为 openSqliteDb 返回值（提供 transaction/run/get/all/exec）
 * 参数：
 *  - db: any（sqlite db wrapper）
 * 返回：{ createDraft, getDraft, applyDraftPatch }
 */
export function createSqliteDraftRepository(db) {
  if (!db) throw new Error("db 不能为空。");
  const idempotency = createSqliteIdempotencyStore(db);
  const resetDraft = createSqliteDraftResetter({ db, idempotency });
  const rollbackDraft = createSqliteDraftRollbacker({ db, idempotency });

  const createDraft = async ({ name }) => {
    const draftId = crypto.randomUUID();
    const version = 1;
    const snapshot = createEmptyDraftSnapshot();
    const createdAt = nowIso();

    await db.transaction(async () => {
      await db.run(
        "INSERT INTO drafts (draft_id, name, head_version, max_version, chat_head_seq, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [draftId, String(name || ""), version, version, 0, createdAt, createdAt],
      );
      await db.run(
        "INSERT INTO draft_versions (draft_id, version, snapshot_json, meta_json, is_archived, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [draftId, version, JSON.stringify(snapshot), JSON.stringify({ source: "create" }), 0, createdAt],
      );
    });

    return { draftId, version, snapshot };
  };

  const getDraft = async ({ draftId }) => {
    const id = String(draftId || "").trim();
    if (!id) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "draftId 不能为空。" });

    const row = await db.get(
      `
        SELECT d.draft_id AS draft_id, d.head_version AS version, v.snapshot_json AS snapshot_json
        FROM drafts d
        JOIN draft_versions v ON v.draft_id = d.draft_id AND v.version = d.head_version
        WHERE d.draft_id = ?
      `,
      [id],
    );

    if (!row) return null;
    const snapshot = (() => {
      try {
        return JSON.parse(String(row.snapshot_json || ""));
      } catch {
        return null;
      }
    })();
    return { draftId: row.draft_id, version: toIntStrict(row.version) ?? 0, snapshot: snapshot ?? null };
  };

  const getDraftMeta = async ({ draftId }) => {
    const id = String(draftId || "").trim();
    if (!id) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "draftId 不能为空。" });
    const meta = await readDraftMetaRow(db, id);
    if (!meta) return null;
    return { draftId: id, ...meta };
  };

  const applyDraftPatch = async ({ draftId, baseVersion, requestId, mode, patchOps, meta: applyMeta }) => {
    const id = String(draftId || "").trim();
    if (!id) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "draftId 不能为空。" });
    const base = toIntStrict(baseVersion);
    if (base === null || base < 1) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "baseVersion 非法。" });

    const ops = Array.isArray(patchOps) ? patchOps : [];
    const allowEmptyPatch = Boolean(applyMeta?.allowEmptyPatch);
    if (ops.length === 0 && !allowEmptyPatch) {
      throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "patchOps 不能为空。" });
    }

    const reqId = String(requestId || "").trim() || "";
    const source = String(applyMeta?.source || "ui-apply").trim() || "ui-apply";
    const runId = String(applyMeta?.runId || "").trim() || "";
    const turnIndex = toIntStrict(applyMeta?.turnIndex);

    return await db.transaction(async () => {
      const existed = await idempotency.get({ draftId: id, requestId: reqId, kind: IDEMPOTENCY_KIND_DRAFT_APPLY });
      if (existed) return existed;

      const draftMeta = await readDraftMetaRow(db, id);
      if (!draftMeta) {
        throw new ApiError({ httpStatus: 404, code: ERROR_CODES.DRAFT_NOT_FOUND, message: "草稿不存在。" });
      }

      if (base !== draftMeta.headVersion) {
        throw new ApiError({
          httpStatus: 409,
          code: ERROR_CODES.VERSION_CONFLICT,
          message: "baseVersion 与 latestVersion 不一致。",
          details: { baseVersion: base, latestVersion: draftMeta.headVersion },
        });
      }

      const snapshot = await getSnapshotByVersion(db, { draftId: id, version: draftMeta.headVersion });
      if (!snapshot) throw new Error("headVersion 快照缺失。");

      const applied = (() => {
        if (ops.length === 0) {
          return { mode: "auto", snapshot: structuredClone(snapshot), changedPaths: [] };
        }
        return applyPatchOps({ snapshot, patchOps: ops, mode });
      })();

      const post = postProcessSnapshot({
        snapshot: applied.snapshot,
        changedPaths: applied.changedPaths,
        meta: { ...(applyMeta || {}), source },
      });

      const nextVersion = draftMeta.maxVersion + 1;
      const createdAt = nowIso();
      const metaJson = {
        source,
        requestId: reqId || undefined,
        runId: runId || undefined,
        turnIndex: turnIndex ?? undefined,
        baseVersion: base,
        mode: applied.mode,
        changedPaths: post.changedPaths,
        chatHeadSeq: draftMeta.chatHeadSeq,
      };

      await db.run(
        "INSERT INTO draft_versions (draft_id, version, snapshot_json, meta_json, is_archived, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [id, nextVersion, JSON.stringify(post.snapshot), JSON.stringify(metaJson), 0, createdAt],
      );
      await db.run("UPDATE drafts SET head_version = ?, max_version = ?, updated_at = ? WHERE draft_id = ?", [
        nextVersion,
        nextVersion,
        createdAt,
        id,
      ]);

      const result = {
        draftId: id,
        requestId: reqId || undefined,
        baseVersion: base,
        version: nextVersion,
        changedPaths: post.changedPaths,
        snapshot: post.snapshot,
      };

      await idempotency.setIfAbsent({ draftId: id, requestId: reqId, kind: IDEMPOTENCY_KIND_DRAFT_APPLY, result });
      return result;
    });
  };

  return { createDraft, getDraft, getDraftMeta, applyDraftPatch, resetDraft, rollbackDraft };
}
