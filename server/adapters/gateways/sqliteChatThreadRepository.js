/**
 * 文件：sqliteChatThreadRepository.js
 * 模块：server/adapters/gateways
 * 作用：ChatThread 仓储（SQLite：chat_threads/chat_thread_messages）
 * 依赖：server/shared/apiError、server/shared/errorCodes
 * @created 2026-01-11
 * @modified 2026-01-11
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

function normalizeLimit(value) {
  const n = toIntStrict(value);
  if (n === null) return 50;
  return Math.max(1, Math.min(200, n));
}

function normalizeBeforeSeq(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = toIntStrict(value);
  if (n === null || n < 1) return null;
  return n;
}

function normalizeRole(value) {
  const r = normalizeText(value);
  if (r === "user" || r === "assistant") return r;
  return "";
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

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function toThreadFromRow(row) {
  if (!row) return null;
  const ctx = safeJsonParse(row.ctx_json);
  return {
    threadId: normalizeText(row.id),
    name: normalizeText(row.name),
    presetName: normalizeText(row.preset_name),
    ctx: isPlainObject(ctx) ? ctx : {},
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
  };
}

async function getThreadHeadRow(tx, threadId) {
  const row = await tx.get("SELECT head_seq FROM chat_threads WHERE id = ?", [threadId]);
  if (!row) return null;
  return { headSeq: toIntStrict(row.head_seq) ?? 0 };
}

async function listMessages(tx, { threadId, beforeSeq, limit }) {
  if (beforeSeq !== null) {
    return await tx.all(
      "SELECT seq, role, content, created_at FROM chat_thread_messages WHERE thread_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?",
      [threadId, beforeSeq, limit],
    );
  }
  return await tx.all(
    "SELECT seq, role, content, created_at FROM chat_thread_messages WHERE thread_id = ? ORDER BY seq DESC LIMIT ?",
    [threadId, limit],
  );
}

/**
 * 中文注释：
 * createSqliteChatThreadRepository(db)
 * 作用：创建 ChatThreadRepository（SQLite 实现）
 * 约束：写操作必须事务化，确保 seq 连续；单机单用户无需 userId
 * 参数：
 *  - db: any（openSqliteDb 返回值）
 * 返回：{ createThread, getThreadById, updateThreadById, getThreadMessagesPage, clearThreadMessages, appendThreadMessages }
 */
export function createSqliteChatThreadRepository(db) {
  if (!db) throw new Error("db 不能为空。");

  const createThread = async ({ threadId, name, presetName, ctx }) => {
    const id = normalizeText(threadId);
    if (!id) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "threadId 不能为空。" });
    const preset = normalizeText(presetName);
    if (!preset) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "presetName 不能为空。" });

    const at = nowIso();
    await db.run(
      "INSERT INTO chat_threads (id, name, preset_name, ctx_json, head_seq, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, normalizeText(name), preset, safeJsonStringify(isPlainObject(ctx) ? ctx : {}), 0, at, at],
    );
    const row = await db.get("SELECT * FROM chat_threads WHERE id = ?", [id]);
    return toThreadFromRow(row);
  };

  const getThreadById = async ({ threadId }) => {
    const id = normalizeText(threadId);
    if (!id) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "threadId 不能为空。" });
    const row = await db.get("SELECT * FROM chat_threads WHERE id = ?", [id]);
    return toThreadFromRow(row);
  };

  const updateThreadById = async ({ threadId, name, presetName, ctx }) => {
    const id = normalizeText(threadId);
    if (!id) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "threadId 不能为空。" });

    const current = await getThreadById({ threadId: id });
    if (!current) return null;

    const nextName = name === undefined ? current.name : normalizeText(name);
    const nextPresetName = presetName === undefined ? current.presetName : normalizeText(presetName);
    const nextCtx = ctx === undefined ? current.ctx : isPlainObject(ctx) ? ctx : {};
    const at = nowIso();

    await db.run("UPDATE chat_threads SET name = ?, preset_name = ?, ctx_json = ?, updated_at = ? WHERE id = ?", [
      nextName,
      nextPresetName,
      safeJsonStringify(nextCtx),
      at,
      id,
    ]);

    return { ...current, name: nextName, presetName: nextPresetName, ctx: nextCtx, updatedAt: at };
  };

  const getThreadMessagesPage = async ({ threadId, beforeSeq, limit }) => {
    const id = normalizeText(threadId);
    if (!id) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "threadId 不能为空。" });

    const l = normalizeLimit(limit);
    const b = normalizeBeforeSeq(beforeSeq);

    const head = await getThreadHeadRow(db, id);
    if (!head) throw new ApiError({ httpStatus: 404, code: ERROR_CODES.CHAT_THREAD_NOT_FOUND, message: "会话不存在。" });

    const rows = await listMessages(db, { threadId: id, beforeSeq: b, limit: l });
    const items = (Array.isArray(rows) ? rows : [])
      .map((r) => ({
        seq: toIntStrict(r.seq) ?? 0,
        role: normalizeText(r.role),
        content: String(r.content || ""),
        createdAt: String(r.created_at || ""),
      }))
      .filter((x) => x.seq > 0 && (x.role === "user" || x.role === "assistant"));

    items.sort((a, b2) => a.seq - b2.seq);
    return { threadId: id, headSeq: head.headSeq, items };
  };

  const clearThreadMessages = async ({ threadId }) => {
    const id = normalizeText(threadId);
    if (!id) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "threadId 不能为空。" });

    return await db.transaction(async () => {
      const head = await getThreadHeadRow(db, id);
      if (!head) throw new ApiError({ httpStatus: 404, code: ERROR_CODES.CHAT_THREAD_NOT_FOUND, message: "会话不存在。" });
      const deleted = await db.run("DELETE FROM chat_thread_messages WHERE thread_id = ?", [id]);
      const at = nowIso();
      await db.run("UPDATE chat_threads SET head_seq = 0, updated_at = ? WHERE id = ?", [at, id]);
      return { threadId: id, deleted: Number(deleted?.changes || 0) };
    });
  };

  const appendThreadMessages = async ({ threadId, messages }) => {
    const id = normalizeText(threadId);
    if (!id) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "threadId 不能为空。" });
    const list = Array.isArray(messages) ? messages : [];
    if (list.length === 0) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "messages 不能为空。" });

    const toInsert = list.map((m) => {
      const role = normalizeRole(m?.role);
      if (!role) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "role 非法（仅支持 user/assistant）。" });
      return { role, content: String(m?.content ?? "") };
    });

    return await db.transaction(async () => {
      const head = await getThreadHeadRow(db, id);
      if (!head) throw new ApiError({ httpStatus: 404, code: ERROR_CODES.CHAT_THREAD_NOT_FOUND, message: "会话不存在。" });

      let seq = head.headSeq;
      const inserted = [];
      for (const m of toInsert) {
        seq += 1;
        const at = nowIso();
        await db.run(
          "INSERT INTO chat_thread_messages (thread_id, seq, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
          [id, seq, m.role, m.content, at],
        );
        inserted.push({ threadId: id, seq, role: m.role, content: m.content, createdAt: at });
      }

      const updatedAt = nowIso();
      await db.run("UPDATE chat_threads SET head_seq = ?, updated_at = ? WHERE id = ?", [seq, updatedAt, id]);
      return { threadId: id, inserted, headSeq: seq, updatedAt };
    });
  };

  return {
    createThread,
    getThreadById,
    updateThreadById,
    getThreadMessagesPage,
    clearThreadMessages,
    appendThreadMessages,
  };
}

