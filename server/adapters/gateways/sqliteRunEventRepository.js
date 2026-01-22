/**
 * 文件：sqliteRunEventRepository.js
 * 模块：server/adapters/gateways
 * 作用：Run 事件流仓储（SQLite：run_events，append-only）
 * 依赖：无
 * @created 2026-01-08
 * @modified 2026-01-08
 */

function nowIso() {
  return new Date().toISOString();
}

function toIntOrNull(value) {
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

function toPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

function mapEventRow(runId, row) {
  if (!row) return null;
  return {
    runId,
    seq: toIntOrNull(row.seq) ?? 0,
    type: String(row.type || "message"),
    data: toPlainObject(safeJsonParse(row.data_json)) || {},
    createdAt: String(row.created_at || ""),
  };
}

async function allocateNextSeq(tx, runId) {
  const row = await tx.get("SELECT COALESCE(MAX(seq), 0) AS max_seq FROM run_events WHERE run_id = ?", [runId]);
  return (toIntOrNull(row?.max_seq) ?? 0) + 1;
}

function normalizeLimit(value) {
  const n = toIntOrNull(value);
  if (n === null) return 200;
  return Math.max(1, Math.min(500, n));
}

async function getLatestEventMeta(db, runId) {
  const row = await db.get("SELECT seq, type FROM run_events WHERE run_id = ? ORDER BY seq DESC LIMIT 1", [runId]);
  if (!row) return null;
  return { seq: toIntOrNull(row.seq) ?? 0, type: String(row.type || "message") };
}

async function getLatestEventByType(db, runId, type) {
  const row = await db.get("SELECT seq, type, data_json, created_at FROM run_events WHERE run_id = ? AND type = ? ORDER BY seq DESC LIMIT 1", [
    runId,
    type,
  ]);
  return mapEventRow(runId, row);
}

/**
 * 中文注释：
 * createSqliteRunEventRepository(db)
 * 作用：创建 RunEventRepository（append-only + seq 递增）
 * 约束：seq 在单 run 内递增；data_json 必须为可 JSON.stringify 的对象
 * 参数：
 *  - db: any（openSqliteDb 返回值）
 * 返回：{ appendEvent, listEventsAfter, getLatestEventMeta, getLatestEventByType }
 */
export function createSqliteRunEventRepository(db) {
  if (!db) throw new Error("db 不能为空。");

  const appendEvent = async ({ runId, type, data }) => {
    const id = String(runId || "").trim();
    const t = String(type || "").trim() || "message";
    if (!id) throw new Error("runId 不能为空。");

    const payload = toPlainObject(data) || {};
    const json = JSON.stringify(payload);
    const createdAt = nowIso();

    return await db.transaction(async () => {
      const seq = await allocateNextSeq(db, id);
      await db.run("INSERT INTO run_events (run_id, seq, type, data_json, created_at) VALUES (?, ?, ?, ?, ?)", [id, seq, t, json, createdAt]);
      return { runId: id, seq, type: t, data: payload, createdAt };
    });
  };

  const listEventsAfter = async ({ runId, afterSeq, limit }) => {
    const id = String(runId || "").trim();
    if (!id) throw new Error("runId 不能为空。");
    const after = Math.max(0, toIntOrNull(afterSeq) ?? 0);
    const l = normalizeLimit(limit);

    const rows = await db.all("SELECT seq, type, data_json, created_at FROM run_events WHERE run_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?", [
      id,
      after,
      l,
    ]);

    return rows.map((r) => mapEventRow(id, r));
  };

  const getLatestEventMetaForRun = async ({ runId }) => {
    const id = String(runId || "").trim();
    if (!id) throw new Error("runId 不能为空。");
    return await getLatestEventMeta(db, id);
  };

  const getLatestEventByTypeForRun = async ({ runId, type }) => {
    const id = String(runId || "").trim();
    const t = String(type || "").trim();
    if (!id) throw new Error("runId 不能为空。");
    if (!t) throw new Error("type 不能为空。");
    return await getLatestEventByType(db, id, t);
  };

  return { appendEvent, listEventsAfter, getLatestEventMeta: getLatestEventMetaForRun, getLatestEventByType: getLatestEventByTypeForRun };
}
