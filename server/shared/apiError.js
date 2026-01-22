/**
 * 文件：apiError.js
 * 模块：server/shared
 * 作用：统一 API 错误对象（httpStatus + code + details）
 * 依赖：errorCodes
 * @created 2026-01-07
 * @modified 2026-01-09
 */

import { ERROR_CODES } from "./errorCodes.js";

function normalizeHttpStatus(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 500;
  const i = Math.trunc(n);
  if (i < 400) return 400;
  if (i > 599) return 500;
  return i;
}

function toPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

function toNonEmptyStringOrNull(value) {
  const s = String(value ?? "").trim();
  return s.length > 0 ? s : null;
}

function toPositiveIntOrNull(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return i >= 1 ? i : null;
}

/**
 * 中文注释：
 * ApiError({ httpStatus, code, message, details, requestId, runId, draftId, baseVersion, latestVersion })
 * 作用：统一承载业务错误（可序列化为稳定 JSON）
 * 约束：code 必须为字符串；details 必须为 plain object 或 null
 * 参数：
 *  - httpStatus: number（HTTP 状态码，默认 500）
 *  - code: string（错误码）
 *  - message: string（可展示错误信息）
 *  - details: object|null（结构化详情）
 *  - requestId: string|undefined（可选：原样回传/链路关联）
 *  - runId: string|undefined（可选：Run 相关错误）
 *  - draftId: string|undefined（可选：Draft 相关错误）
 *  - baseVersion: number|undefined（可选：并发校验入参）
 *  - latestVersion: number|undefined（可选：并发校验最新 headVersion）
 */
export class ApiError extends Error {
  constructor({ httpStatus, code, message, details, requestId, runId, draftId, baseVersion, latestVersion }) {
    super(String(message || ""));
    this.name = "ApiError";
    this.httpStatus = normalizeHttpStatus(httpStatus ?? 500);
    this.code = String(code || ERROR_CODES.INTERNAL_ERROR);
    this.details = toPlainObject(details);
    this.requestId = toNonEmptyStringOrNull(requestId);
    this.runId = toNonEmptyStringOrNull(runId);
    this.draftId = toNonEmptyStringOrNull(draftId);
    this.baseVersion = toPositiveIntOrNull(baseVersion);
    this.latestVersion = toPositiveIntOrNull(latestVersion);
  }

  toJson() {
    const details = this.details || {};
    const requestId = this.requestId ?? toNonEmptyStringOrNull(details.requestId);
    const runId = this.runId ?? toNonEmptyStringOrNull(details.runId);
    const draftId = this.draftId ?? toNonEmptyStringOrNull(details.draftId);
    const baseVersion = this.baseVersion ?? toPositiveIntOrNull(details.baseVersion);
    const latestVersion = this.latestVersion ?? toPositiveIntOrNull(details.latestVersion);

    return {
      ok: false,
      code: this.code,
      message: String(this.message || ""),
      requestId: requestId ?? undefined,
      runId: runId ?? undefined,
      details: this.details ?? undefined,
      draftId: draftId ?? undefined,
      baseVersion: baseVersion ?? undefined,
      latestVersion: latestVersion ?? undefined,
    };
  }
}

export function isApiError(err) {
  return err instanceof ApiError;
}

export function toApiError(err) {
  if (isApiError(err)) return err;
  return new ApiError({
    httpStatus: 500,
    code: ERROR_CODES.INTERNAL_ERROR,
    message: String(err?.message || err || "内部错误"),
  });
}

export function badRequest(message, details) {
  return new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message, details });
}

export function notFound(code, message, details) {
  return new ApiError({ httpStatus: 404, code, message, details });
}

export function conflict(code, message, details) {
  return new ApiError({ httpStatus: 409, code, message, details });
}
