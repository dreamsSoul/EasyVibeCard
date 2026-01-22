/**
 * 文件：sqlitePresetRepository.js
 * 模块：server/adapters/gateways
 * 作用：Preset 仓储（SQLite：presets；仅存归一化后的 ST 预设）
 * 依赖：server/shared/apiError、server/shared/errorCodes
 * @created 2026-01-11
 * @modified 2026-01-11
 */

import { ApiError } from "../../shared/apiError.js";
import { ERROR_CODES } from "../../shared/errorCodes.js";

function nowIso() {
  return new Date().toISOString();
}

function normalizeName(value) {
  return String(value ?? "").trim();
}

function safeJsonParse(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

/**
 * 中文注释：
 * createSqlitePresetRepository(db)
 * 作用：创建 PresetRepository（SQLite 实现）
 * 约束：仅存归一化后的 preset_json；name 为主键；不存任何 apiKey
 * 参数：
 *  - db: any（openSqliteDb 返回值）
 * 返回：{ listPresets, getPresetByName, upsertPreset, deletePresetByName }
 */
export function createSqlitePresetRepository(db) {
  if (!db) throw new Error("db 不能为空。");

  const listPresets = async () => {
    const rows = await db.all("SELECT name, updated_at FROM presets ORDER BY updated_at DESC");
    return (Array.isArray(rows) ? rows : [])
      .map((r) => ({ name: normalizeName(r?.name), updatedAt: String(r?.updated_at || "") }))
      .filter((x) => x.name);
  };

  const getPresetByName = async ({ name }) => {
    const n = normalizeName(name);
    if (!n) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "preset.name 不能为空。" });

    const row = await db.get("SELECT preset_json, created_at, updated_at FROM presets WHERE name = ?", [n]);
    if (!row) return null;

    const preset = safeJsonParse(row.preset_json);
    if (!preset || typeof preset !== "object") return null;
    return { name: n, preset, createdAt: String(row.created_at || ""), updatedAt: String(row.updated_at || "") };
  };

  const upsertPreset = async ({ name, preset }) => {
    const n = normalizeName(name);
    if (!n) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "preset.name 不能为空。" });

    const at = nowIso();
    await db.run(
      `
        INSERT INTO presets (name, preset_json, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET preset_json = excluded.preset_json, updated_at = excluded.updated_at
      `,
      [n, safeJsonStringify(preset), at, at],
    );
    return await getPresetByName({ name: n });
  };

  const deletePresetByName = async ({ name }) => {
    const n = normalizeName(name);
    if (!n) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "preset.name 不能为空。" });
    const existed = await db.get("SELECT name FROM presets WHERE name = ?", [n]);
    if (!existed) return { deleted: 0 };
    const r = await db.run("DELETE FROM presets WHERE name = ?", [n]);
    return { deleted: Number(r?.changes || 0) };
  };

  return { listPresets, getPresetByName, upsertPreset, deletePresetByName };
}

