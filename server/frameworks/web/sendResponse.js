/**
 * 文件：sendResponse.js
 * 模块：server/frameworks/web
 * 作用：统一 API JSON 响应（ok / error）
 * 依赖：server/shared/apiError
 * @created 2026-01-07
 * @modified 2026-01-09
 */

import { toApiError } from "../../shared/apiError.js";

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

function toPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

function pickReqContext(req) {
  const ctx = toPlainObject(req?.__apiContext) || {};
  const requestId =
    toNonEmptyStringOrNull(ctx.requestId) ??
    toNonEmptyStringOrNull(req?.body?.requestId) ??
    toNonEmptyStringOrNull(req?.query?.requestId);
  const runId =
    toNonEmptyStringOrNull(ctx.runId) ?? toNonEmptyStringOrNull(req?.params?.runId) ?? toNonEmptyStringOrNull(req?.body?.runId);
  const draftId =
    toNonEmptyStringOrNull(ctx.draftId) ?? toNonEmptyStringOrNull(req?.params?.id) ?? toNonEmptyStringOrNull(req?.body?.draftId);
  const baseVersion = toPositiveIntOrNull(ctx.baseVersion) ?? toPositiveIntOrNull(req?.body?.baseVersion);
  return { requestId, runId, draftId, baseVersion };
}

/**
 * 中文注释：
 * sendOk(res, data)
 * 作用：发送标准成功响应（{ ok: true, ...data }）
 * 约束：data 必须为 plain object；避免返回敏感字段
 * 参数：
 *  - res: any（Express Response）
 *  - data: object（响应负载）
 * 返回：any（res）
 */
export function sendOk(res, data) {
  const body = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  return res.json({ ok: true, ...body });
}

/**
 * 中文注释：
 * sendError(req, res, err)
 * 作用：发送标准失败响应（对齐契约：补齐 requestId/runId/draftId/baseVersion/latestVersion 顶层字段）
 * 约束：err 会被归一化为 ApiError；仅从 req 提取“安全上下文字段”以便前端定位
 * 参数：
 *  - req: any（Express Request）
 *  - res: any（Express Response）
 *  - err: any（错误）
 * 返回：any（res）
 */
export function sendError(req, res, err) {
  const apiError = toApiError(err);
  const json = apiError.toJson();
  const ctx = pickReqContext(req);

  return res.status(apiError.httpStatus).json({
    ...json,
    requestId: json.requestId ?? ctx.requestId ?? undefined,
    runId: json.runId ?? ctx.runId ?? undefined,
    draftId: json.draftId ?? ctx.draftId ?? undefined,
    baseVersion: json.baseVersion ?? ctx.baseVersion ?? undefined,
    latestVersion: json.latestVersion ?? undefined,
  });
}
