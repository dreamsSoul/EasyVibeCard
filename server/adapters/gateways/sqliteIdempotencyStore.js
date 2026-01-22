/**
 * 文件：sqliteIdempotencyStore.js
 * 模块：server/adapters/gateways
 * 作用：幂等键存储（SQLite：idempotency_keys）
 * 依赖：无
 * @created 2026-01-07
 * @modified 2026-01-07
 */

function nowIso() {
  return new Date().toISOString();
}

function toPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
}

async function getRawResult(db, { draftId, requestId, kind }) {
  const row = await db.get(
    "SELECT result_json FROM idempotency_keys WHERE draft_id = ? AND request_id = ? AND kind = ?",
    [draftId, requestId, kind],
  );
  return row?.result_json ?? null;
}

/**
 * 中文注释：
 * createSqliteIdempotencyStore(db)
 * 作用：提供幂等键 get/setIfAbsent（用于 requestId 去重）
 * 约束：result_json 必须为可 JSON.stringify 的对象；禁止存敏感信息（如 apiKey 明文）
 * 参数：
 *  - db: any（openSqliteDb 返回值）
 * 返回：{ get, setIfAbsent }
 */
export function createSqliteIdempotencyStore(db) {
  if (!db) throw new Error("db 不能为空。");

  const get = async ({ draftId, requestId, kind }) => {
    const id = String(draftId || "").trim();
    const reqId = String(requestId || "").trim();
    const k = String(kind || "").trim();
    if (!id || !reqId || !k) return null;

    const raw = await getRawResult(db, { draftId: id, requestId: reqId, kind: k });
    const parsed = safeJsonParse(raw);
    return toPlainObject(parsed);
  };

  const setIfAbsent = async ({ draftId, requestId, kind, result }) => {
    const id = String(draftId || "").trim();
    const reqId = String(requestId || "").trim();
    const k = String(kind || "").trim();
    if (!id || !reqId || !k) return null;

    const json = JSON.stringify(result);
    const at = nowIso();

    try {
      await db.run(
        "INSERT INTO idempotency_keys (draft_id, request_id, kind, result_json, created_at) VALUES (?, ?, ?, ?, ?)",
        [id, reqId, k, json, at],
      );
      return result;
    } catch {
      const existed = await get({ draftId: id, requestId: reqId, kind: k });
      return existed ?? result;
    }
  };

  return { get, setIfAbsent };
}

