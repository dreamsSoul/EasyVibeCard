/**
 * 文件：initAppDb.js
 * 模块：server/frameworks/database/sqlite
 * 作用：应用级 SQLite 初始化（打开连接 + 执行迁移）
 * 依赖：sqliteDb、migrate、migrations
 * @created 2026-01-07
 * @modified 2026-01-07
 */

import path from "node:path";

import { runSqliteMigrations } from "./migrate.js";
import { SQLITE_MIGRATIONS } from "./migrations.js";
import { openSqliteDb } from "./sqliteDb.js";

function normalizeDbFile({ filename, projectRoot }) {
  const fromEnv = String(filename || process.env.SQLITE_FILE || "").trim();
  if (fromEnv) return fromEnv;
  const base = String(projectRoot || "").trim();
  if (!base) throw new Error("projectRoot 不能为空（无法推导默认 SQLITE_FILE）。");
  return path.join(base, ".data", "app.sqlite3");
}

/**
 * 中文注释：
 * initAppDb({ projectRoot, filename })
 * 作用：初始化应用数据库（打开 SQLite + 执行迁移）
 * 约束：默认路径为 <projectRoot>/.data/app.sqlite3；也可通过 SQLITE_FILE 覆盖
 * 参数：
 *  - projectRoot: string（项目根目录：1/）
 *  - filename: string（可选，显式指定 DB 文件路径）
 * 返回：Promise<{ db, migrated }>
 */
export async function initAppDb({ projectRoot, filename }) {
  const dbFile = normalizeDbFile({ filename, projectRoot });
  const db = await openSqliteDb({ filename: dbFile });
  const migrated = await runSqliteMigrations(db, SQLITE_MIGRATIONS);
  return { db, migrated };
}

