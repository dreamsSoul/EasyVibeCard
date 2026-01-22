/**
 * 文件：modelOutput.js
 * 模块：server/use-cases/vcard/turn
 * 作用：模型输出错误码映射与 read/patch 混合判定
 * 依赖：server/shared/errorCodes、normalize
 * @created 2026-01-07
 * @modified 2026-01-16
 */

import { ERROR_CODES } from "../../../shared/errorCodes.js";

import { normalizeText } from "./normalize.js";

export function toModelErrorCode(parseError) {
  const msg = String(parseError || "");
  if (msg.includes("JSON 解析失败")) return ERROR_CODES.MODEL_OUTPUT_INVALID_JSON;
  if (msg.includes("tool_use") || msg.includes("<tool_use>")) return ERROR_CODES.MODEL_OUTPUT_INVALID_JSON;
  return ERROR_CODES.MODEL_OUTPUT_KIND_NOT_ALLOWED;
}

export function pickReadMixState(items) {
  const list = Array.isArray(items) ? items : [];
  const hasRead = list.some((x) => normalizeText(x?.kind) === "read");
  const onlyRead = list.length === 1 && hasRead;
  return { hasRead, onlyRead };
}
