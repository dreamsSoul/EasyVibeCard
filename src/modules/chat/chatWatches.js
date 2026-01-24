/**
 * 文件：chatWatches.js
 * 模块：聊天
 * 作用：集中挂载 useChatState 的 watch（settings 同步 + apiKey 本地持久化）
 * 依赖：Vue watch、shared/apiV1/settings
 * @created 2026-01-11
 * @modified 2026-01-11
 */

import { watch } from "vue";
import { writeApiSensitive } from "./chatStateHelpers";

// 中文注释：
// attachChatWatches(deps)
// 作用：注册 useChatState 所需的 watch（preset 选择、settings debounce、apiKey 持久化）
// 约束：依赖 booted 防止初始化阶段误触发 patch；settings patch 使用 400ms debounce
// 参数：
//  - deps: { selectedPresetName, ctx, ui, api, booted, patchApiV1Settings, refreshActivePreset, syncThreadMeta, syncVcardOutputCleanerFromActivePreset }
// 返回：void
export function attachChatWatches({
  selectedPresetName,
  ctx,
  ui,
  api,
  booted,
  patchApiV1Settings,
  refreshActivePreset,
  syncThreadMeta,
  syncVcardOutputCleanerFromActivePreset,
}) {
  watch(
    () => selectedPresetName.value,
    async (next) => {
      if (!booted.value) return;
      try {
        const out = await patchApiV1Settings({ selectedPresetName: next });
        await refreshActivePreset();
        if (typeof syncVcardOutputCleanerFromActivePreset === "function") {
          await syncVcardOutputCleanerFromActivePreset({ settings: out });
        }
        await syncThreadMeta();
      } catch (err) {
        ui.lastError = `保存预设选择失败：${String(err?.message || err)}`;
      }
    },
  );

  let patchTimer = null;
  watch(
    () => [ctx, ui.stream, ui.reasoningEffort, ui.includeReasoning, api.providerOverride, api.modelOverride, api.providers],
    () => {
      if (!booted.value) return;
      if (patchTimer) clearTimeout(patchTimer);
      patchTimer = setTimeout(async () => {
        patchTimer = null;
        try {
          await patchApiV1Settings({
            ctx,
            ui: { stream: Boolean(ui.stream), reasoningEffort: String(ui.reasoningEffort || "auto"), includeReasoning: Boolean(ui.includeReasoning) },
            apiNonSensitive: {
              providerOverride: String(api.providerOverride || ""),
              modelOverride: String(api.modelOverride || ""),
              providers: {
                openai: { baseUrl: String(api.providers.openai.baseUrl || "") },
                claude: { baseUrl: String(api.providers.claude.baseUrl || "") },
                makersuite: { baseUrl: String(api.providers.makersuite.baseUrl || "") },
                vertexai: {
                  baseUrl: String(api.providers.vertexai.baseUrl || ""),
                  region: String(api.providers.vertexai.region || "us-central1"),
                  projectId: String(api.providers.vertexai.projectId || ""),
                },
              },
            },
          });
        } catch (err) {
          ui.lastError = `保存设置失败：${String(err?.message || err)}`;
        }
      }, 400);
    },
    { deep: true },
  );

  watch(
    () => [api.rememberKey, api.providers.openai.key, api.providers.claude.key, api.providers.makersuite.key, api.providers.vertexai.key],
    () => writeApiSensitive(api),
  );
}

