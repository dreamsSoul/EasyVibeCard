/**
 * 文件：settingsRoutes.js
 * 模块：server/frameworks/web/apiV1
 * 作用：Settings API（/api/v1/settings）
 * 依赖：use-cases/settings、sendResponse
 * @created 2026-01-11
 * @modified 2026-01-11
 */

import { getSettingsInteractor, patchSettingsInteractor } from "../../../use-cases/settings/interactors.js";
import { sendOk } from "../sendResponse.js";

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/**
 * 中文注释：
 * attachSettingsRoutes(app, deps)
 * 作用：挂载 Settings API（GET/PATCH）
 * 约束：不返回 apiKey；由前端自行保存并每次请求带上来
 * 参数：
 *  - app: any（Express app）
 *  - deps: { settingsRepo:any }
 * 返回：void
 */
export function attachSettingsRoutes(app, deps) {
  app.get(
    "/api/v1/settings",
    asyncHandler(async (_req, res) => {
      const out = await getSettingsInteractor({ settingsRepo: deps.settingsRepo });
      return sendOk(res, out);
    }),
  );

  app.patch(
    "/api/v1/settings",
    asyncHandler(async (req, res) => {
      const patch = req?.body || {};
      const out = await patchSettingsInteractor({ settingsRepo: deps.settingsRepo, patch });
      return sendOk(res, out);
    }),
  );
}

