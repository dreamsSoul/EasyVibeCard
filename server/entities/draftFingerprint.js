/**
 * 文件：draftFingerprint.js
 * 模块：server/entities
 * 作用：为草稿快照计算指纹（用于 pending 审批的乐观锁）
 * 依赖：node:crypto
 * @created 2026-01-17
 * @modified 2026-01-17
 */

import crypto from "node:crypto";

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

/**
 * 中文注释：
 * fingerprintDraftSnapshot(snapshot)
 * 作用：计算 draft snapshot 的指纹（sha1(JSON)）
 * 约束：仅用于乐观锁；不保证跨不同 JSON 序列化策略完全稳定
 * 参数：
 *  - snapshot: any
 * 返回：string（hex）
 */
export function fingerprintDraftSnapshot(snapshot) {
  const json = safeJsonStringify(snapshot);
  return crypto.createHash("sha1").update(json).digest("hex");
}

