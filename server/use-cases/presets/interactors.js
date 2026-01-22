/**
 * 文件：interactors.js
 * 模块：server/use-cases/presets
 * 作用：Presets 用例（list/get/import/delete/patch）
 * 依赖：server/entities/presets、server/shared/apiError
 * @created 2026-01-11
 * @modified 2026-01-20
 */

import { BUILTIN_DEFAULT_PRESET } from "../../entities/presets/builtinDefaultPreset.js";
import { applyPresetPatch, presetPatchFields } from "../../entities/presets/applyPresetPatch.js";
import { normalizeImportedPreset } from "../../entities/presets/normalizeImportedPreset.js";
import { ApiError } from "../../shared/apiError.js";
import { ERROR_CODES } from "../../shared/errorCodes.js";

function normalizeName(value) {
  return String(value ?? "").trim();
}

function isBuiltinPresetName(name) {
  return normalizeName(name) === normalizeName(BUILTIN_DEFAULT_PRESET.name);
}

/**
 * 中文注释：
 * listPresetsInteractor({ presetRepo })
 * 作用：列出可用 presets（含内置默认 + DB）
 * 约束：返回仅含 name，避免大 payload
 * 参数：
 *  - presetRepo: { listPresets }
 * 返回：Promise<{ presets: Array<{name:string}> }>
 */
export async function listPresetsInteractor({ presetRepo }) {
  if (!presetRepo?.listPresets) throw new Error("presetRepo.listPresets 缺失。");

  const rows = await presetRepo.listPresets();
  const names = new Set([normalizeName(BUILTIN_DEFAULT_PRESET.name)]);
  for (const r of Array.isArray(rows) ? rows : []) {
    const n = normalizeName(r?.name);
    if (!n) continue;
    if (isBuiltinPresetName(n)) continue;
    names.add(n);
  }
  return { presets: Array.from(names).map((name) => ({ name })) };
}

/**
 * 中文注释：
 * getPresetInteractor({ presetRepo, name })
 * 作用：获取指定 preset（支持内置默认）
 * 约束：不存在则抛出 PRESET_NOT_FOUND
 * 参数：
 *  - presetRepo: { getPresetByName }
 *  - name: string
 * 返回：Promise<{ preset: object }>
 */
export async function getPresetInteractor({ presetRepo, name }) {
  if (!presetRepo?.getPresetByName) throw new Error("presetRepo.getPresetByName 缺失。");
  const n = normalizeName(name);
  if (!n) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "preset.name 不能为空。" });

  if (isBuiltinPresetName(n)) return { preset: BUILTIN_DEFAULT_PRESET };
  const row = await presetRepo.getPresetByName({ name: n });
  if (!row?.preset) throw new ApiError({ httpStatus: 404, code: ERROR_CODES.PRESET_NOT_FOUND, message: "预设不存在。" });
  return { preset: row.preset };
}

/**
 * 中文注释：
 * importPresetInteractor({ presetRepo, fileName, rawPreset })
 * 作用：导入并归一化 preset，然后保存到 DB
 * 约束：以 normalized.name 为主键 upsert；fileName 仅用于推导默认 name
 * 参数：
 *  - presetRepo: { upsertPreset }
 *  - fileName: string
 *  - rawPreset: any
 * 返回：Promise<{ preset: object }>
 */
export async function importPresetInteractor({ presetRepo, fileName, rawPreset }) {
  if (!presetRepo?.upsertPreset) throw new Error("presetRepo.upsertPreset 缺失。");
  const normalized = normalizeImportedPreset(rawPreset, fileName);
  if (isBuiltinPresetName(normalized?.name)) {
    throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "不能用导入覆盖内置默认预设。" });
  }
  const saved = await presetRepo.upsertPreset({ name: normalized.name, preset: normalized });
  return { preset: saved?.preset || normalized };
}

/**
 * 中文注释：
 * deletePresetInteractor({ presetRepo, name })
 * 作用：删除指定 preset（不允许删除内置默认）
 * 约束：不存在则抛出 PRESET_NOT_FOUND
 * 参数：
 *  - presetRepo: { deletePresetByName }
 *  - name: string
 * 返回：Promise<{}>
 */
export async function deletePresetInteractor({ presetRepo, name }) {
  if (!presetRepo?.deletePresetByName) throw new Error("presetRepo.deletePresetByName 缺失。");
  const n = normalizeName(name);
  if (!n) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "preset.name 不能为空。" });
  if (isBuiltinPresetName(n)) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "内置默认预设不可删除。" });

  const r = await presetRepo.deletePresetByName({ name: n });
  if (!r?.deleted) throw new ApiError({ httpStatus: 404, code: ERROR_CODES.PRESET_NOT_FOUND, message: "预设不存在。" });
  return {};
}

/**
 * 中文注释：
 * patchPresetInteractor({ presetRepo, name, patch })
 * 作用：更新指定 preset（仅允许白名单字段）
 * 约束：内置默认不可更新；patch 为空时报错
 * 参数：
 *  - presetRepo: { getPresetByName, upsertPreset }
 *  - name: string
 *  - patch: object
 * 返回：Promise<{ preset: object }>
 */
export async function patchPresetInteractor({ presetRepo, name, patch }) {
  if (!presetRepo?.getPresetByName) throw new Error("presetRepo.getPresetByName 缺失。");
  if (!presetRepo?.upsertPreset) throw new Error("presetRepo.upsertPreset 缺失。");

  const n = normalizeName(name);
  if (!n) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "preset.name 不能为空。" });
  if (isBuiltinPresetName(n)) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "内置默认预设不可修改。" });

  const row = await presetRepo.getPresetByName({ name: n });
  if (!row?.preset) throw new ApiError({ httpStatus: 404, code: ERROR_CODES.PRESET_NOT_FOUND, message: "预设不存在。" });

  const patched = applyPresetPatch(row.preset, patch);
  if (!patched.hasPatch) {
    throw new ApiError({
      httpStatus: 400,
      code: ERROR_CODES.BAD_REQUEST,
      message: `预设更新字段为空，仅允许：${presetPatchFields().join(", ")}`,
    });
  }

  const saved = await presetRepo.upsertPreset({ name: n, preset: patched.preset });
  return { preset: saved?.preset || patched.preset };
}
