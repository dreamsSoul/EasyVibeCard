/**
 * 文件：readProtocol.js
 * 模块：server/entities/vcard
 * 作用：Read 协议聚合导出（normalizeReadRequest + buildReadResultText）
 * 依赖：server/entities/vcard/readProtocol/*
 * @created 2026-01-07
 * @modified 2026-01-08
 */

export { VCARD_READ_RESULT_PREFIX } from "./readProtocol/constants.js";
export { normalizeReadRequest } from "./readProtocol/normalizeReadRequest.js";
export { buildReadResultText } from "./readProtocol/buildReadResultText.js";
