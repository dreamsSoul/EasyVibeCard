/**
 * 文件：constants.js
 * 模块：server/use-cases/vcard/runs
 * 作用：VCard Run 常量（幂等 kind / stopReason 枚举）
 * 依赖：无
 * @created 2026-01-08
 * @modified 2026-01-08
 */

export const IDEMPOTENCY_KIND_VCARD_RUN_START = "vcard_run_start";

export const RUN_STATUS = Object.freeze({
  RUNNING: "running",
  STOPPED: "stopped",
});

export const RUN_STOP_REASONS = Object.freeze({
  DONE: "done",
  NO_CHANGE: "no_change",
  PLAN_NO_PROGRESS: "plan_no_progress",
  MAX_TURNS: "max_turns",
  TIMEOUT: "timeout",
  CANCELED: "canceled",
  ERROR: "error",
});

