/**
 * 文件：constants.js
 * 模块：server/use-cases/vcard/turn
 * 作用：VCard Turn 常量（read-loop 安全阈值/幂等 kind）
 * 依赖：无
 * @created 2026-01-07
 * @modified 2026-01-20
 */

export const IDEMPOTENCY_KIND_VCARD_TURN = "vcard_turn";
export const IDEMPOTENCY_KIND_VCARD_TURN_USER_TEXT = "vcard_turn_user_text";
export const MAX_WORLD_INFO_AFTER_APPEND_CHARS = 120000;

export const VCARD_CTRL_PREFIX = "【VCARD_CTRL】";
