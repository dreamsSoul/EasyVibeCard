/**
 * 文件：presetsRoutes.js
 * 模块：server/frameworks/web/apiV1
 * 作用：Presets API（/api/v1/presets）
 * 依赖：use-cases/presets、sendResponse
 * @created 2026-01-11
 * @modified 2026-01-20
 */

import {
  deletePresetInteractor,
  getPresetInteractor,
  importPresetInteractor,
  listPresetsInteractor,
  patchPresetInteractor,
} from "../../../use-cases/presets/interactors.js";
import { sendOk } from "../sendResponse.js";

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function decodePathParam(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return String(value || "");
  }
}

/**
 * 中文注释：
 * attachPresetRoutes(app, deps)
 * 作用：挂载 Presets API（list/get/import/delete）
 * 约束：服务端保存 normalize 后的 preset；内置默认不可删除
 * 参数：
 *  - app: any（Express app）
 *  - deps: { presetRepo:any }
 * 返回：void
 */
export function attachPresetRoutes(app, deps) {
  app.get(
    "/api/v1/presets",
    asyncHandler(async (_req, res) => {
      const out = await listPresetsInteractor({ presetRepo: deps.presetRepo });
      return sendOk(res, out);
    }),
  );

  app.get(
    "/api/v1/presets/:name",
    asyncHandler(async (req, res) => {
      const name = decodePathParam(req?.params?.name);
      const out = await getPresetInteractor({ presetRepo: deps.presetRepo, name });
      return sendOk(res, out);
    }),
  );

  app.post(
    "/api/v1/presets/import",
    asyncHandler(async (req, res) => {
      const body = req?.body || {};
      const out = await importPresetInteractor({
        presetRepo: deps.presetRepo,
        fileName: String(body?.fileName || "preset.json"),
        rawPreset: body?.rawPreset ?? null,
      });
      return sendOk(res, out);
    }),
  );

  app.delete(
    "/api/v1/presets/:name",
    asyncHandler(async (req, res) => {
      const name = decodePathParam(req?.params?.name);
      const out = await deletePresetInteractor({ presetRepo: deps.presetRepo, name });
      return sendOk(res, out);
    }),
  );

  app.patch(
    "/api/v1/presets/:name",
    asyncHandler(async (req, res) => {
      const name = decodePathParam(req?.params?.name);
      const patch = req?.body || {};
      const out = await patchPresetInteractor({ presetRepo: deps.presetRepo, name, patch });
      return sendOk(res, out);
    }),
  );
}
