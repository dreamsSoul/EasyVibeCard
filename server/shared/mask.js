/**
 * 文件：mask.js
 * 模块：server/shared
 * 作用：敏感信息脱敏工具（禁止明文写入日志/DB）
 * 依赖：无
 * @created 2026-01-07
 * @modified 2026-01-07
 */

/**
 * 中文注释：
 * maskApiKey(apiKey)
 * 作用：对 apiKey 做最小可读脱敏（短 key：前2后2；长 key：前4后4）
 * 约束：仅用于 debug 回显；不得替代安全存储
 * 参数：
 *  - apiKey: string
 * 返回：string
 */
export function maskApiKey(apiKey) {
  const k = String(apiKey || "");
  if (!k) return "";
  if (k.length <= 8) return `${k.slice(0, 2)}****${k.slice(-2)}`;
  return `${k.slice(0, 4)}****${k.slice(-4)}`;
}

