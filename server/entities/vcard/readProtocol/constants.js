/**
 * 文件：constants.js
 * 模块：server/entities/vcard/readProtocol
 * 作用：Read 协议常量（与前端 readProtocol 对齐）
 * 依赖：无
 * @created 2026-01-08
 * @modified 2026-01-08
 */

export const VCARD_READ_RESULT_PREFIX = "【VCARD_READ_RESULT】";
export const DEFAULT_LIMIT = 1200;
export const MAX_LIMIT = 6000;
export const MAX_READS = 8;
export const CARD_FILE_KEYS = new Set(["description", "personality", "scenario", "first_mes", "mes_example", "system_prompt", "creator_notes", "post_history_instructions"]);

