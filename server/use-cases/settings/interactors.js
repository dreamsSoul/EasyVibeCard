/**
 * 文件：interactors.js
 * 模块：server/use-cases/settings
 * 作用：Settings 用例（get/patch）
 * 依赖：无
 * @created 2026-01-11
 * @modified 2026-01-11
 */

function pickApiResponseShape(settings) {
  return {
    selectedPresetName: String(settings?.selectedPresetName || "默认（内置）"),
    ctx: settings?.ctx && typeof settings.ctx === "object" ? settings.ctx : {},
    ui: settings?.ui && typeof settings.ui === "object" ? settings.ui : {},
    apiNonSensitive: settings?.apiNonSensitive && typeof settings.apiNonSensitive === "object" ? settings.apiNonSensitive : {},
    vcard: settings?.vcard && typeof settings.vcard === "object" ? settings.vcard : {},
  };
}

/**
 * 中文注释：
 * getSettingsInteractor({ settingsRepo })
 * 作用：读取全局 settings（服务端真源）
 * 约束：不返回 apiKey；由前端自行保存并每次请求带上来
 * 参数：
 *  - settingsRepo: { getSettings }
 * 返回：Promise<{ selectedPresetName, ctx, ui, apiNonSensitive }>
 */
export async function getSettingsInteractor({ settingsRepo }) {
  if (!settingsRepo?.getSettings) throw new Error("settingsRepo.getSettings 缺失。");
  const settings = await settingsRepo.getSettings();
  return pickApiResponseShape(settings);
}

/**
 * 中文注释：
 * patchSettingsInteractor({ settingsRepo, patch })
 * 作用：部分更新 settings（浅合并：ctx/ui/apiNonSensitive.providers）
 * 约束：不接受/不落库 apiKey；patch 允许为 partial
 * 参数：
 *  - settingsRepo: { updateSettings }
 *  - patch: object
 * 返回：Promise<{ selectedPresetName, ctx, ui, apiNonSensitive }>
 */
export async function patchSettingsInteractor({ settingsRepo, patch }) {
  if (!settingsRepo?.updateSettings) throw new Error("settingsRepo.updateSettings 缺失。");
  const updated = await settingsRepo.updateSettings(patch || {});
  return pickApiResponseShape(updated);
}
