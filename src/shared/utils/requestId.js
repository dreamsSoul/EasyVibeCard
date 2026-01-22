/**
 * 文件：requestId.js
 * 模块：shared/utils
 * 作用：生成前端 requestId（用于后端幂等与重试）
 * 依赖：Web Crypto
 * @created 2026-01-14
 * @modified 2026-01-14
 */

// 中文注释：
// createRequestId()
// 作用：生成可用于后端幂等的 requestId
// 约束：优先使用 crypto.randomUUID；无 Web Crypto 时回退到时间戳+随机数
// 返回：string
export function createRequestId() {
  const c = globalThis?.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const ts = Date.now();
  const rand = Math.random().toString(16).slice(2);
  return `req_${ts}_${rand}`;
}

