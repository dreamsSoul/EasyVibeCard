/**
 * 文件：sqliteChatRepository.js
 * 模块：server/adapters/gateways
 * 作用：Chat 仓储（SQLite 实现：分页读取 + 追加写入）
 * 依赖：server/shared/apiError、server/shared/errorCodes
 * @created 2026-01-07
 * @modified 2026-01-07
 */

import { ApiError } from "../../shared/apiError.js";
import { ERROR_CODES } from "../../shared/errorCodes.js";

function nowIso() {
  return new Date().toISOString();
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
  const r = String(value || "").trim();
  if (r === "user" || r === "assistant") return r;
  return "";
}

async function getDraftHead(tx, draftId) {
  const row = await tx.get("SELECT head_version, chat_head_seq FROM drafts WHERE draft_id = ?", [draftId]);
  if (!row) return null;
  return { version: toIntStrict(row.head_version) ?? 0, headSeq: toIntStrict(row.chat_head_seq) ?? 0 };
}

async function listMessages(tx, { draftId, beforeSeq, limit }) {
  if (beforeSeq !== null) {
    return await tx.all(
      "SELECT seq, role, content, created_at FROM chat_messages WHERE draft_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?",
      [draftId, beforeSeq, limit],
    );
  }
  return await tx.all("SELECT seq, role, content, created_at FROM chat_messages WHERE draft_id = ? ORDER BY seq DESC LIMIT ?", [
    draftId,
    limit,
  ]);
}

async function allocateNextSeq(tx, draftId) {
  const head = await getDraftHead(tx, draftId);
  if (!head) return null;
  const nextSeq = head.headSeq + 1;
  const at = nowIso();
  await tx.run("UPDATE drafts SET chat_head_seq = ?, updated_at = ? WHERE draft_id = ?", [nextSeq, at, draftId]);
  return { nextSeq, at };
}

/**
 * 中文注释：
 * createSqliteChatRepository(db)
 * 作用：创建 ChatRepository（SQLite 实现）
 * 约束：所有写操作必须在事务内进行，确保 seq 连续
 * 参数：
 *  - db: any（openSqliteDb 返回值）
 * 返回：{ getDraftChatPage, appendChatMessage }
 */
export function createSqliteChatRepository(db) {
  if (!db) throw new Error("db 不能为空。");

  const getDraftChatPage = async ({ draftId, beforeSeq, limit }) => {
    const id = String(draftId || "").trim();
    if (!id) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "draftId 不能为空。" });

    const l = normalizeLimit(limit);
    const b = normalizeBeforeSeq(beforeSeq);

    const head = await getDraftHead(db, id);
    if (!head) throw new ApiError({ httpStatus: 404, code: ERROR_CODES.DRAFT_NOT_FOUND, message: "草稿不存在。" });

    const rows = await listMessages(db, { draftId: id, beforeSeq: b, limit: l });
    const items = rows
      .map((r) => ({
        seq: toIntStrict(r.seq) ?? 0,
        role: String(r.role || ""),
        content: String(r.content || ""),
        createdAt: String(r.created_at || ""),
      }))
      .filter((x) => x.seq > 0 && (x.role === "user" || x.role === "assistant"));

    items.sort((a, b2) => a.seq - b2.seq);

    return { draftId: id, version: head.version, headSeq: head.headSeq, items };
  };

  const appendChatMessage = async ({ draftId, role, content }) => {
    const id = String(draftId || "").trim();
    if (!id) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "draftId 不能为空。" });
    const r = normalizeRole(role);
    if (!r) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "role 非法（仅支持 user/assistant）。" });
    const text = String(content ?? "");

    return await db.transaction(async () => {
      const alloc = await allocateNextSeq(db, id);
      if (!alloc) throw new ApiError({ httpStatus: 404, code: ERROR_CODES.DRAFT_NOT_FOUND, message: "草稿不存在。" });

      await db.run(
        "INSERT INTO chat_messages (draft_id, seq, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
        [id, alloc.nextSeq, r, text, alloc.at],
      );
      return { draftId: id, seq: alloc.nextSeq, role: r, content: text, createdAt: alloc.at };
    });
  };

  return { getDraftChatPage, appendChatMessage };
}

