/**
 * 文件：sqliteRunLogRepository.js
 * 模块：server/adapters/gateways
 * 作用：RunLog 仓储（SQLite：run_logs）
 * 依赖：无
 * @created 2026-01-07
 * @modified 2026-01-07
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

function toBoolInt(value) {
  return value ? 1 : 0;
}

function toStringArray(value) {
  return (Array.isArray(value) ? value : [])
    .map((x) => String(x ?? "").trim())
    .filter((x) => x.length > 0);
}

/**
 * 中文注释：
 * createSqliteRunLogRepository(db)
 * 作用：创建 RunLogRepository（SQLite 实现：写入 run_logs）
 * 约束：禁止写入敏感信息（如 apiKey 明文、上游原始响应全文）
 * 参数：
 *  - db: any（openSqliteDb 返回值）
 * 返回：{ createRunLog }
 */
export function createSqliteRunLogRepository(db) {
  if (!db) throw new Error("db 不能为空。");

  const createRunLog = async (input) => {
    const id = crypto.randomUUID();
    const createdAt = nowIso();

    const draftId = String(input?.draftId || "").trim();
    const requestId = String(input?.requestId || "").trim() || null;
    const runId = String(input?.runId || "").trim() || null;
    const turnIndex = toIntOrNull(input?.turnIndex);

    const mode = String(input?.mode || "work");
    const reason = String(input?.reason || "");
    const baseVersion = toIntOrNull(input?.baseVersion) ?? 0;
    const version = toIntOrNull(input?.version);

    const ok = Boolean(input?.ok);
    const code = input?.code ? String(input.code) : null;
    const error = String(input?.error || "");

    const provider = String(input?.provider || "openai");
    const stream = Boolean(input?.stream);
    const upstreamStream = Boolean(input?.upstreamStream);

    const readRounds = toIntOrNull(input?.readRounds) ?? 0;
    const assistantChars = toIntOrNull(input?.assistantChars) ?? 0;

    const kinds = toStringArray(input?.kinds);
    const changedPaths = toStringArray(input?.changedPaths);

    await db.run(
      `
        INSERT INTO run_logs (
          id, draft_id, request_id, run_id, turn_index,
          mode, reason,
          base_version, version,
          ok, code, error,
          provider, stream, upstream_stream,
          read_rounds, assistant_chars,
          kinds_json, changed_paths_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        id,
        draftId,
        requestId,
        runId,
        turnIndex,
        mode,
        reason,
        baseVersion,
        version,
        toBoolInt(ok),
        code,
        error,
        provider,
        toBoolInt(stream),
        toBoolInt(upstreamStream),
        readRounds,
        assistantChars,
        JSON.stringify(kinds),
        JSON.stringify(changedPaths),
        createdAt,
      ],
    );

    return {
      id,
      draftId,
      requestId: requestId || undefined,
      runId: runId || undefined,
      turnIndex: turnIndex ?? undefined,
      mode,
      reason,
      baseVersion,
      version: version ?? undefined,
      ok,
      code: code || undefined,
      error,
      provider,
      stream,
      upstreamStream,
      readRounds,
      kinds,
      changedPaths,
      assistantChars,
      createdAt,
    };
  };

  return { createRunLog };
}

