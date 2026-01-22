/**
 * 文件：runRegistry.js
 * 模块：server/use-cases/vcard/runs
 * 作用：Run in-flight abort 注册表（用于 cancel 立即中断）
 * 依赖：无
 * @created 2026-01-20
 * @modified 2026-01-20
 */

const RUN_ABORT_MAP = new Map();

function normalizeRunId(runId) {
  return String(runId || "").trim();
}

/**
 * 中文注释：
 * registerRunAbortController(runId, controller)
 * 作用：登记当前 in-flight 的 AbortController
 * 约束：同一 runId 仅保留最新 controller
 * 参数：
 *  - runId: string
 *  - controller: AbortController
 * 返回：void
 */
export function registerRunAbortController(runId, controller) {
  const id = normalizeRunId(runId);
  if (!id || !controller) return;
  RUN_ABORT_MAP.set(id, controller);
}

/**
 * 中文注释：
 * clearRunAbortController(runId, controller)
 * 作用：清理 in-flight AbortController（仅当匹配时）
 * 参数：
 *  - runId: string
 *  - controller: AbortController
 * 返回：void
 */
export function clearRunAbortController(runId, controller) {
  const id = normalizeRunId(runId);
  if (!id) return;
  const current = RUN_ABORT_MAP.get(id);
  if (!current) return;
  if (controller && current !== controller) return;
  RUN_ABORT_MAP.delete(id);
}

/**
 * 中文注释：
 * abortRunById(runId)
 * 作用：立即中断当前 in-flight 上游请求
 * 参数：
 *  - runId: string
 * 返回：boolean（是否触发 abort）
 */
export function abortRunById(runId) {
  const id = normalizeRunId(runId);
  if (!id) return false;
  const controller = RUN_ABORT_MAP.get(id);
  if (!controller) return false;
  controller.abort();
  return true;
}

export function hasRunAbortController(runId) {
  return RUN_ABORT_MAP.has(normalizeRunId(runId));
}
