/**
 * 文件：draftsRoutes.js
 * 模块：server/frameworks/web/apiV1
 * 作用：Draft API（/api/v1/drafts）
 * 依赖：use-cases/drafts、sendResponse、shared/apiError
 * @created 2026-01-07
 * @modified 2026-01-20
 */

import {
  applyDraftPatchInteractor,
  applyDraftItemsInteractor,
  createDraftInteractor,
  getDraftInteractor,
  resetDraftInteractor,
  rollbackDraftInteractor,
} from "../../../use-cases/drafts/interactors.js";
import { getDraftChatInteractor } from "../../../use-cases/chat/interactors.js";
import { ApiError } from "../../../shared/apiError.js";
import { ERROR_CODES } from "../../../shared/errorCodes.js";
import { sendOk } from "../sendResponse.js";

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/**
 * 中文注释：
 * attachDraftRoutes(app, deps)
 * 作用：挂载 Draft 相关 API（create/get/apply）
 * 约束：deps.draftRepo 为持久化实现（SQLite）
 * 参数：
 *  - app: any（Express app）
 *  - deps: { draftRepo: any, chatRepo: any, runRepo?: any, settingsRepo?: any }
 * 返回：void
 */
export function attachDraftRoutes(app, deps) {
  app.post(
    "/api/v1/drafts",
    asyncHandler(async (req, res) => {
      const name = req?.body?.name;
      const out = await createDraftInteractor({ draftRepo: deps.draftRepo, name });
      return sendOk(res, out);
    }),
  );

  app.get(
    "/api/v1/drafts/:id",
    asyncHandler(async (req, res) => {
      const draftId = String(req?.params?.id || "");
      const out = await getDraftInteractor({ draftRepo: deps.draftRepo, draftId });
      if (!out) throw new ApiError({ httpStatus: 404, code: ERROR_CODES.DRAFT_NOT_FOUND, message: "草稿不存在。" });
      return sendOk(res, out);
    }),
  );

  app.post(
    "/api/v1/drafts/:id/apply",
    asyncHandler(async (req, res) => {
      const draftId = String(req?.params?.id || "");
      const body = req?.body || {};
      const out = await applyDraftPatchInteractor({
        draftRepo: deps.draftRepo,
        runRepo: deps.runRepo,
        draftId,
        baseVersion: body.baseVersion,
        requestId: body.requestId,
        mode: body.mode,
        patchOps: body.patchOps,
      });
      return sendOk(res, out);
    }),
  );

  app.post(
    "/api/v1/drafts/:id/apply-items",
    asyncHandler(async (req, res) => {
      const draftId = String(req?.params?.id || "");
      const body = req?.body || {};
      const out = await applyDraftItemsInteractor({
        draftRepo: deps.draftRepo,
        runRepo: deps.runRepo,
        draftId,
        baseVersion: body.baseVersion,
        requestId: body.requestId,
        mode: body.mode,
        items: body.items,
      });
      return sendOk(res, out);
    }),
  );

  app.post(
    "/api/v1/drafts/:id/reset",
    asyncHandler(async (req, res) => {
      const draftId = String(req?.params?.id || "");
      const body = req?.body || {};
      const out = await resetDraftInteractor({
        draftRepo: deps.draftRepo,
        draftId,
        baseVersion: body.baseVersion,
        requestId: body.requestId,
        toVersion: body.toVersion,
        confirm: body.confirm,
      });
      return sendOk(res, out);
    }),
  );

  app.post(
    "/api/v1/drafts/:id/rollback",
    asyncHandler(async (req, res) => {
      const draftId = String(req?.params?.id || "");
      const body = req?.body || {};
      const out = await rollbackDraftInteractor({
        draftRepo: deps.draftRepo,
        draftId,
        baseVersion: body.baseVersion,
        requestId: body.requestId,
        toVersion: body.toVersion,
      });
      return sendOk(res, out);
    }),
  );

  app.get(
    "/api/v1/drafts/:id/chat",
    asyncHandler(async (req, res) => {
      const draftId = String(req?.params?.id || "");
      const { beforeSeq, limit, view } = req?.query || {};
      const out = await getDraftChatInteractor({ chatRepo: deps.chatRepo, settingsRepo: deps.settingsRepo, draftId, beforeSeq, limit, view });
      return sendOk(res, out);
    }),
  );
}
