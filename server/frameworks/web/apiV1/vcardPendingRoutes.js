/**
 * 文件：vcardPendingRoutes.js
 * 模块：server/frameworks/web/apiV1
 * 作用：VCard Pending API（/api/v1/vcard/pending + approve/accept/reject）
 * 依赖：use-cases/vcard/pending、sendResponse
 * @created 2026-01-17
 * @modified 2026-01-17
 */

import {
  acceptVcardPendingPatchInteractor,
  approveVcardPendingPlanInteractor,
  getVcardPendingInteractor,
  rejectVcardPendingPatchInteractor,
  rejectVcardPendingPlanInteractor,
} from "../../../use-cases/vcard/pending/interactors.js";
import { sendOk } from "../sendResponse.js";

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/**
 * 中文注释：
 * attachVcardPendingRoutes(app, deps)
 * 作用：挂载 VCard pending 相关接口（查询 pending + plan/patch 审批动作）
 * 约束：审批动作必须做 baseVersion + fpBefore 乐观锁校验；草稿存在 running Run 时返回 DRAFT_BUSY
 * 参数：
 *  - app: any（Express app）
 *  - deps: { draftRepo:any, runRepo?:any, pendingRepo:any }
 * 返回：void
 */
export function attachVcardPendingRoutes(app, deps) {
  app.get(
    "/api/v1/vcard/pending",
    asyncHandler(async (req, res) => {
      const draftId = String(req?.query?.draftId || "").trim();
      const out = await getVcardPendingInteractor({ draftRepo: deps.draftRepo, pendingRepo: deps.pendingRepo, draftId });
      return sendOk(res, out);
    }),
  );

  app.post(
    "/api/v1/vcard/pending/plan/approve",
    asyncHandler(async (req, res) => {
      const body = req?.body || {};
      const out = await approveVcardPendingPlanInteractor({
        draftRepo: deps.draftRepo,
        runRepo: deps.runRepo,
        pendingRepo: deps.pendingRepo,
        draftId: String(body?.draftId || "").trim(),
        baseVersion: body?.baseVersion,
        fpBefore: body?.fpBefore,
        editedPlan: body?.editedPlan,
        requestId: body?.requestId,
      });
      return sendOk(res, out);
    }),
  );

  app.post(
    "/api/v1/vcard/pending/plan/reject",
    asyncHandler(async (req, res) => {
      const body = req?.body || {};
      const out = await rejectVcardPendingPlanInteractor({
        draftRepo: deps.draftRepo,
        runRepo: deps.runRepo,
        pendingRepo: deps.pendingRepo,
        draftId: String(body?.draftId || "").trim(),
        baseVersion: body?.baseVersion,
        fpBefore: body?.fpBefore,
      });
      return sendOk(res, out);
    }),
  );

  app.post(
    "/api/v1/vcard/pending/patch/accept",
    asyncHandler(async (req, res) => {
      const body = req?.body || {};
      const out = await acceptVcardPendingPatchInteractor({
        draftRepo: deps.draftRepo,
        runRepo: deps.runRepo,
        pendingRepo: deps.pendingRepo,
        draftId: String(body?.draftId || "").trim(),
        baseVersion: body?.baseVersion,
        fpBefore: body?.fpBefore,
        requestId: body?.requestId,
      });
      return sendOk(res, out);
    }),
  );

  app.post(
    "/api/v1/vcard/pending/patch/reject",
    asyncHandler(async (req, res) => {
      const body = req?.body || {};
      const out = await rejectVcardPendingPatchInteractor({
        draftRepo: deps.draftRepo,
        runRepo: deps.runRepo,
        pendingRepo: deps.pendingRepo,
        draftId: String(body?.draftId || "").trim(),
        baseVersion: body?.baseVersion,
        fpBefore: body?.fpBefore,
      });
      return sendOk(res, out);
    }),
  );
}

