/**
 * 文件：migrate.js
 * 模块：server/frameworks/database/sqlite
 * 作用：SQLite 迁移执行器（schema_migrations + 事务执行）
 * 依赖：无
 * @created 2026-01-07
 * @modified 2026-01-07
 */

function nowIso() {
  return new Date().toISOString();
}

function normalizeMigration(m) {
  const id = String(m?.id || "").trim();
  const up = String(m?.up || "").trim();
  if (!id) throw new Error("migration.id 不能为空。");
  if (!up) throw new Error(`migration.up 不能为空（${id}）。`);
  return { id, up };
}

async function ensureSchemaMigrationsTable(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
}

async function listAppliedIds(db) {
  const rows = await db.all("SELECT id FROM schema_migrations ORDER BY applied_at ASC");
  return new Set(rows.map((r) => String(r?.id || "")).filter((x) => x));
}

/**
 * 中文注释：
 * runSqliteMigrations(db, migrations)
 * 作用：执行 SQLite 迁移（已执行跳过，未执行按顺序事务执行）
 * 约束：migrations 为 append-only；每条迁移在独立事务内执行
 * 参数：
 *  - db: { exec, run, all, transaction }（openSqliteDb 返回值）
 *  - migrations: Array<{ id: string, up: string }>
 * 返回：Promise<{ applied: string[], skipped: string[] }>
 */
export async function runSqliteMigrations(db, migrations) {
  const list = (Array.isArray(migrations) ? migrations : []).map(normalizeMigration);
  const seen = new Set();
  for (const m of list) {
    if (seen.has(m.id)) throw new Error(`migration.id 重复：${m.id}`);
    seen.add(m.id);
  }

  await ensureSchemaMigrationsTable(db);
  const appliedIds = await listAppliedIds(db);

  const applied = [];
  const skipped = [];

  for (const m of list) {
    if (appliedIds.has(m.id)) {
      skipped.push(m.id);
      continue;
    }

    await db.transaction(async () => {
      await db.exec(m.up);
      await db.run("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)", [m.id, nowIso()]);
    });
    applied.push(m.id);
  }

  return { applied, skipped };
}

