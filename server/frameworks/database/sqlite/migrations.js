/**
 * 文件：migrations.js
 * 模块：server/frameworks/database/sqlite
 * 作用：SQLite 迁移清单（按顺序执行，append-only）
 * 依赖：无
 * @created 2026-01-07
 * @modified 2026-01-07
 */

const MIGRATION_2026_01_07_0001_DRAFTS = {
  id: "2026-01-07-0001-drafts",
  up: `
    CREATE TABLE IF NOT EXISTS drafts (
      draft_id TEXT PRIMARY KEY,
      name TEXT,
      head_version INTEGER NOT NULL,
      max_version INTEGER NOT NULL,
      chat_head_seq INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS draft_versions (
      draft_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      meta_json TEXT NOT NULL,
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      PRIMARY KEY (draft_id, version),
      FOREIGN KEY (draft_id) REFERENCES drafts(draft_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_draft_versions_draft_id ON draft_versions(draft_id);
    CREATE INDEX IF NOT EXISTS idx_draft_versions_draft_id_version ON draft_versions(draft_id, version);

    CREATE TABLE IF NOT EXISTS idempotency_keys (
      draft_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (draft_id, request_id, kind),
      FOREIGN KEY (draft_id) REFERENCES drafts(draft_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_idempotency_keys_draft_id_kind ON idempotency_keys(draft_id, kind);
  `,
};

const MIGRATION_2026_01_07_0002_CHAT_MESSAGES = {
  id: "2026-01-07-0002-chat-messages",
  up: `
    CREATE TABLE IF NOT EXISTS chat_messages (
      draft_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (draft_id, seq),
      FOREIGN KEY (draft_id) REFERENCES drafts(draft_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_draft_id_seq ON chat_messages(draft_id, seq);
  `,
};

const MIGRATION_2026_01_07_0003_RUN_LOGS = {
  id: "2026-01-07-0003-run-logs",
  up: `
    CREATE TABLE IF NOT EXISTS run_logs (
      id TEXT PRIMARY KEY,
      draft_id TEXT NOT NULL,
      request_id TEXT,
      run_id TEXT,
      turn_index INTEGER,

      mode TEXT NOT NULL,
      reason TEXT NOT NULL,

      base_version INTEGER NOT NULL,
      version INTEGER,

      ok INTEGER NOT NULL,
      code TEXT,
      error TEXT NOT NULL,

      provider TEXT NOT NULL,
      stream INTEGER NOT NULL,
      upstream_stream INTEGER NOT NULL,

      read_rounds INTEGER NOT NULL,
      assistant_chars INTEGER NOT NULL,

      kinds_json TEXT NOT NULL,
      changed_paths_json TEXT NOT NULL,
      created_at TEXT NOT NULL,

      FOREIGN KEY (draft_id) REFERENCES drafts(draft_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_run_logs_draft_id_created_at ON run_logs(draft_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_run_logs_request_id ON run_logs(request_id);
    CREATE INDEX IF NOT EXISTS idx_run_logs_run_id ON run_logs(run_id);
  `,
};

const MIGRATION_2026_01_08_0004_RUNS = {
  id: "2026-01-08-0004-runs",
  up: `
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      draft_id TEXT NOT NULL,
      request_id TEXT,
      base_version INTEGER NOT NULL,
      version INTEGER NOT NULL,
      status TEXT NOT NULL,
      stop_reason TEXT,
      stop_message TEXT,
      turns INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      stopped_at TEXT,
      FOREIGN KEY (draft_id) REFERENCES drafts(draft_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_runs_draft_id_status ON runs(draft_id, status);
    CREATE INDEX IF NOT EXISTS idx_runs_request_id ON runs(request_id);

    CREATE TABLE IF NOT EXISTS run_events (
      run_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (run_id, seq),
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_run_events_run_id_seq ON run_events(run_id, seq);
  `,
};

export const SQLITE_MIGRATIONS = Object.freeze([
  MIGRATION_2026_01_07_0001_DRAFTS,
  MIGRATION_2026_01_07_0002_CHAT_MESSAGES,
  MIGRATION_2026_01_07_0003_RUN_LOGS,
  MIGRATION_2026_01_08_0004_RUNS,
  {
    id: "2026-01-11-0005-settings-presets-chat-threads",
    up: `
      CREATE TABLE IF NOT EXISTS app_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        selected_preset_name TEXT,
        ctx_json TEXT NOT NULL,
        ui_json TEXT NOT NULL,
        api_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS presets (
        name TEXT PRIMARY KEY,
        preset_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_presets_updated_at ON presets(updated_at);

      CREATE TABLE IF NOT EXISTS chat_threads (
        id TEXT PRIMARY KEY,
        name TEXT,
        preset_name TEXT NOT NULL,
        ctx_json TEXT NOT NULL,
        head_seq INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chat_threads_updated_at ON chat_threads(updated_at);

      CREATE TABLE IF NOT EXISTS chat_thread_messages (
        thread_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (thread_id, seq),
        FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_chat_thread_messages_thread_id_seq ON chat_thread_messages(thread_id, seq);
    `,
  },
  {
    id: "2026-01-14-0006-settings-vcard",
    up: `
      ALTER TABLE app_settings ADD COLUMN vcard_json TEXT NOT NULL DEFAULT '{}';
    `,
  },
  {
    id: "2026-01-17-0007-draft-pending-actions",
    up: `
      CREATE TABLE IF NOT EXISTS draft_pending_actions (
        draft_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        base_version INTEGER NOT NULL,
        fp_before TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (draft_id) REFERENCES drafts(draft_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_draft_pending_actions_kind ON draft_pending_actions(kind);
      CREATE INDEX IF NOT EXISTS idx_draft_pending_actions_updated_at ON draft_pending_actions(updated_at);
    `,
  },
]);
