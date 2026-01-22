/**
 * 文件：validators.js
 * 模块：server/entities/patchOps
 * 作用：patchOps 校验（op/path/root）
 * 依赖：server/shared/apiError、server/shared/errorCodes、path
 * @created 2026-01-07
 * @modified 2026-01-07
 */

import { ApiError } from "../../shared/apiError.js";
import { ERROR_CODES } from "../../shared/errorCodes.js";

import { PATCH_ROOT_KEYS, parsePatchPath } from "./path.js";

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

export function ensureRootAllowed(rootKey, opIndex) {
  if (PATCH_ROOT_KEYS.includes(rootKey)) return;
  throw new ApiError({
    httpStatus: 400,
    code: ERROR_CODES.PATCH_ROOT_FORBIDDEN,
    message: `root 不允许：${rootKey || "（空）"}`,
    details: { opIndex, rootKey },
  });
}

export function ensureCardPathAllowed(snapshot, segments, opIndex, rawPath) {
  if (segments.length !== 2 || segments[1]?.index !== null) {
    throw new ApiError({
      httpStatus: 400,
      code: ERROR_CODES.PATCH_PATH_INVALID,
      message: "card 仅支持 card.<field> 形式。",
      details: { opIndex, path: rawPath },
    });
  }

  const field = String(segments[1]?.key || "");
  if (!field || !isPlainObject(snapshot?.card) || !(field in snapshot.card)) {
    throw new ApiError({
      httpStatus: 400,
      code: ERROR_CODES.PATCH_PATH_INVALID,
      message: `未知 card 字段：${field || "（空）"}`,
      details: { opIndex, path: rawPath },
    });
  }
}

export function ensureRawPathAllowed(segments, opIndex, rawPath) {
  const ok =
    segments.length === 3 &&
    segments[0]?.key === "raw" &&
    segments[0]?.index === null &&
    segments[1]?.key === "dataExtensions" &&
    segments[1]?.index === null &&
    segments[2]?.key &&
    segments[2]?.index === null;

  if (!ok) {
    throw new ApiError({
      httpStatus: 400,
      code: ERROR_CODES.PATCH_PATH_INVALID,
      message: "raw 仅允许 raw.dataExtensions.<key>。",
      details: { opIndex, path: rawPath },
    });
  }

  // 仅保留 vibePlan：避免模型/客户端写入任意 raw 扩展导致边界失效。
  if (String(segments[2]?.key || "") !== "vibePlan") {
    throw new ApiError({
      httpStatus: 400,
      code: ERROR_CODES.MODE_FORBIDDEN,
      message: "raw.dataExtensions 仅允许修改 vibePlan。",
      details: { path: rawPath, opIndex },
    });
  }

  return;
}

export function normalizePatchOp(op, opIndex) {
  if (!isPlainObject(op)) {
    throw new ApiError({
      httpStatus: 400,
      code: ERROR_CODES.PATCH_OP_INVALID,
      message: "patchOps 项必须是 object。",
      details: { opIndex },
    });
  }

  const type = String(op.op || "").trim();
  if (type !== "set" && type !== "remove") {
    throw new ApiError({
      httpStatus: 400,
      code: ERROR_CODES.PATCH_OP_INVALID,
      message: `不支持的 op：${type || "（空）"}`,
      details: { opIndex },
    });
  }

  const rawPath = String(op.path || "").trim();
  const segments = parsePatchPath(rawPath);
  if (!segments) {
    throw new ApiError({
      httpStatus: 400,
      code: ERROR_CODES.PATCH_PATH_INVALID,
      message: `path 非法：${rawPath || "（空）"}`,
      details: { opIndex, path: rawPath },
    });
  }

  const hasValue = Object.prototype.hasOwnProperty.call(op, "value");
  return { type, path: rawPath, segments, hasValue, value: op.value };
}

export function ensureRemovePathAllowed(rootKey, segments, opIndex, rawPath) {
  const root = String(rootKey || "");

  if (root === "worldbook") {
    const ok = segments.length === 2 && segments[1]?.key === "entries" && segments[1]?.index !== null;
    if (ok) return;
    throw new ApiError({
      httpStatus: 400,
      code: ERROR_CODES.PATCH_OP_INVALID,
      message: "remove 仅支持 worldbook.entries[i]。",
      details: { opIndex, path: rawPath },
    });
  }

  if (root === "regex_scripts") {
    const ok = segments.length === 1 && segments[0]?.index !== null;
    if (ok) return;
    throw new ApiError({
      httpStatus: 400,
      code: ERROR_CODES.PATCH_OP_INVALID,
      message: "remove 仅支持 regex_scripts[i]。",
      details: { opIndex, path: rawPath },
    });
  }

  if (root === "tavern_helper") {
    const scriptsOk = segments.length === 2 && segments[1]?.key === "scripts" && segments[1]?.index !== null;
    const varsOk =
      segments.length === 3 &&
      segments[1]?.key === "variables" &&
      segments[1]?.index === null &&
      segments[2]?.key &&
      segments[2]?.index === null;

    if (scriptsOk || varsOk) return;
    throw new ApiError({
      httpStatus: 400,
      code: ERROR_CODES.PATCH_OP_INVALID,
      message: "remove 仅支持 tavern_helper.scripts[i] 或 tavern_helper.variables.someKey。",
      details: { opIndex, path: rawPath },
    });
  }

  throw new ApiError({
    httpStatus: 400,
    code: ERROR_CODES.PATCH_OP_INVALID,
    message: "remove 暂不支持该根路径。",
    details: { opIndex, path: rawPath },
  });
}
