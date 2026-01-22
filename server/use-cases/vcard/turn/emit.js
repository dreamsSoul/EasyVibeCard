/**
 * 文件：emit.js
 * 模块：server/use-cases/vcard/turn
 * 作用：SSE/事件回调的安全封装（避免 emit 异常影响主流程）
 * 依赖：无
 * @created 2026-01-07
 * @modified 2026-01-07
 */

export function emitSafe(emit, type, data) {
  try {
    if (typeof emit === "function") emit(type, data);
  } catch {
    // ignore
  }
}

