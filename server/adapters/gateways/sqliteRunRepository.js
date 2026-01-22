/**
 * 文件：sqliteRunRepository.js
 * 模块：server/adapters/gateways
 * 作用：Run 仓储（SQLite：runs）
 * 依赖：无
 * @created 2026-01-08
 * @modified 2026-01-08
 */

import crypto from "node:crypto";

function nowIso() {
  return new Date().toISOString();
}

function toIntOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function toStringOrNull(value) {
  const s = String(value ?? "").trim();
  return s.length > 0 ? s : null;
}

function normalizeStatus(value) {
  const s = String(value || "").trim();
  return s === "stopped" ? "stopped" : "running";
}

function normalizeStopReason(value) {
  const s = String(value || "").trim();
  return s.length > 0 ? s : null;
}

function normalizeStopMessage(value) {
  const s = String(value || "").trim();
  return s.length > 0 ? s : null;
}

function mapRunRow(row) {
  if (!row) return null;
  return {
    runId: String(row.id || ""),
    draftId: String(row.draft_id || ""),
    requestId: row.request_id ? String(row.request_id) : undefined,
    baseVersion: toIntOrNull(row.base_version) ?? 0,
    version: toIntOrNull(row.version) ?? 0,
    status: normalizeStatus(row.status),
    stopReason: row.stop_reason ? String(row.stop_reason) : undefined,
    stopMessage: row.stop_message ? String(row.stop_message) : undefined,
    turns: toIntOrNull(row.turns) ?? 0,
    createdAt: String(row.created_at || ""),
    stoppedAt: row.stopped_at ? String(row.stopped_at) : undefined,
  };
}

/**
 * 中文注释：
 * createSqliteRunRepository(db)
 * 作用：创建 RunRepository（SQLite 实现：runs）
 * 约束：Run 与事件流（run_events）解耦；本仓储只负责 runs 状态与游标字段
 * 参数：
 *  - db: any（openSqliteDb 返回值）
 * 返回：{ createRun, getRun, findRunningByDraftId, updateProgress, stopRun }
 */
export function createSqliteRunRepository(db) {
  if (!db) throw new Error("db 不能为空。");

  const createRun = async ({ draftId, requestId, baseVersion }) => {
    const id = crypto.randomUUID();
    const createdAt = nowIso();

    const dId = String(draftId || "").trim();
    const reqId = toStringOrNull(requestId);
    const base = toIntOrNull(baseVersion);
    if (!dId) throw new Error("draftId 不能为空。");
    if (base === null || base < 1) throw new Error("baseVersion 非法。");

    await db.run(
      `
        INSERT INTO runs (
          id, draft_id, request_id,
          base_version, version,
          status, stop_reason, stop_message,
          turns, created_at, stopped_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [id, dId, reqId, base, base, "running", null, null, 0, createdAt, null],
    );

    return {
      runId: id,
      draftId: dId,
      requestId: reqId || undefined,
      baseVersion: base,
      version: base,
      status: "running",
      turns: 0,
      createdAt,
    };
  };

  const getRun = async ({ runId }) => {
    const id = String(runId || "").trim();
    if (!id) return null;
    const row = await db.get("SELECT * FROM runs WHERE id = ?", [id]);
    return mapRunRow(row);
  };

  const findRunningByDraftId = async ({ draftId }) => {
    const dId = String(draftId || "").trim();
    if (!dId) return null;
    const row = await db.get("SELECT * FROM runs WHERE draft_id = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1", [dId]);
    return mapRunRow(row);
  };

  const updateProgress = async ({ runId, turns, version }) => {
    const id = String(runId || "").trim();
    if (!id) return;
    const t = Math.max(0, toIntOrNull(turns) ?? 0);
    const v = Math.max(0, toIntOrNull(version) ?? 0);
    await db.run("UPDATE runs SET turns = ?, version = ? WHERE id = ? AND status = 'running'", [t, v, id]);
  };

  const stopRun = async ({ runId, stopReason, stopMessage, turns, version }) => {
    const id = String(runId || "").trim();
    if (!id) return;
    const stoppedAt = nowIso();
    const reason = normalizeStopReason(stopReason);
    const message = normalizeStopMessage(stopMessage);
    const t = Math.max(0, toIntOrNull(turns) ?? 0);
    const v = Math.max(0, toIntOrNull(version) ?? 0);

    await db.run("UPDATE runs SET status = 'stopped', stop_reason = ?, stop_message = ?, turns = ?, version = ?, stopped_at = ? WHERE id = ?", [
      reason,
      message,
      t,
      v,
      stoppedAt,
      id,
    ]);
  };

  return { createRun, getRun, findRunningByDraftId, updateProgress, stopRun };
}

