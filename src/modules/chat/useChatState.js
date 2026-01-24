/**
 * 文件：useChatState.js
 * 模块：聊天
 * 作用：以服务端为真源：Settings/Presets/Chat Threads；前端仅保存 apiKey 并每次请求带上来
 * 依赖：Vue、shared/apiV1、shared/messages、shared/llm、chatStateHelpers
 * @created 2025-12-28
 * @modified 2026-01-20
 */

import { computed, onMounted, reactive, ref, watch } from "vue";

import {
  buildMessages,
  BUILTIN_DEFAULT_PRESET,
  normalizeProvider,
  pickModelFromPreset,
  pickUseSystemPromptFromPreset,
  getApiV1Settings,
  patchApiV1Settings,
  listApiV1Presets,
  getApiV1PresetByName,
  importApiV1Preset,
  patchApiV1PresetByName,
  deleteApiV1PresetByName,
  createApiV1ChatThread,
  getApiV1ChatThread,
  patchApiV1ChatThread,
  listApiV1ChatThreadMessages,
  clearApiV1ChatThreadMessages,
} from "../../shared";

import { cloneJson, normalizeText, readApiSensitive, readThreadId, toTimeLabel, writeThreadId } from "./chatStateHelpers";
import { createChatSendMessage } from "./chatSendMessage";
import { attachChatWatches } from "./chatWatches";
import { defaultOutputCleanerConfig } from "../vcard/domain/outputCleaner";

function toPresetNameList(list) {
  const names = (Array.isArray(list) ? list : []).map((p) => ({ name: String(p?.name || "").trim() })).filter((p) => p.name);
  if (!names.some((p) => p.name === BUILTIN_DEFAULT_PRESET.name)) names.unshift({ name: BUILTIN_DEFAULT_PRESET.name });
  return names;
}

/**
 * 中文注释：
 * useChatState()
 * 作用：组合式状态：预设/设置/会话/消息；请求走 /api/v1/chat/threads；apiKey 前端保存并随请求发送
 * 约束：服务端不落库 apiKey；前端仅本地保存 key（可选 rememberKey）；错误写入 ui.lastError
 * 参数：无
 * 返回：{ presets, activePreset, chat, sendMessage, ... }
 */
export function useChatState() {
  const presets = ref([{ name: BUILTIN_DEFAULT_PRESET.name }]);
  const selectedPresetName = ref(BUILTIN_DEFAULT_PRESET.name);
  const activePresetRef = ref(cloneJson(BUILTIN_DEFAULT_PRESET));
  const activePresetBaseRef = ref(cloneJson(BUILTIN_DEFAULT_PRESET));
  const presetSaving = ref(false);
  const presetSaveError = ref("");
  const presetSavedAt = ref(0);

  const threadId = ref(readThreadId());
  const chat = ref([]);
  const userInput = ref("");
  const sending = ref(false);

  const api = reactive({
    providerOverride: "",
    modelOverride: "",
    rememberKey: false,
    providers: {
      openai: { baseUrl: "http://localhost:11434/v1", key: "" },
      claude: { baseUrl: "", key: "" },
      makersuite: { baseUrl: "", key: "" },
      vertexai: { baseUrl: "", key: "", region: "us-central1", projectId: "" },
    },
  });

  const ctx = reactive({
    user: "",
    char: "",
    personaDescription: "",
    charDescription: "",
    charPersonality: "",
    scenario: "",
    worldInfoBefore: "",
    worldInfoAfter: "",
    dialogueExamples: "",
  });

  const ui = reactive({
    stream: false,
    reasoningEffort: "auto",
    includeReasoning: false,
    showPreview: false,
    showDebug: false,
    lastError: "",
  });

  const debugState = ref(null);
  const booted = ref(false);

  const activePreset = computed(() => activePresetRef.value || BUILTIN_DEFAULT_PRESET);

  function isPlainObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  function pickPresetRegexScripts(preset) {
    const p = preset && typeof preset === "object" ? preset : {};
    const ext = isPlainObject(p.extensions) ? p.extensions : {};
    return Array.isArray(ext.regex_scripts) ? ext.regex_scripts : [];
  }

  function buildOutputCleanerRulesFromPreset(preset) {
    const scripts = pickPresetRegexScripts(preset);
    const rules = scripts
      .filter((s) => s && typeof s === "object")
      .map((s) => {
        const name = normalizeText(s.scriptName || "");
        const pattern = String(s.findRegex || "");
        if (!pattern.trim()) return null;
        const style = pattern.trim().startsWith("/") ? "slash" : "raw";
        return {
          name,
          enabled: !Boolean(s.disabled),
          style,
          pattern,
          flags: style === "raw" ? "g" : "",
          replace: String(s.replaceString ?? ""),
        };
      })
      .filter(Boolean);
    return rules;
  }

  function stableRuleListKey(rules) {
    const list = Array.isArray(rules) ? rules : [];
    const stable = list.map((r) => ({
      name: normalizeText(r?.name || ""),
      enabled: r?.enabled === undefined ? true : Boolean(r.enabled),
      style: String(r?.style || ""),
      pattern: String(r?.pattern || ""),
      flags: String(r?.flags || ""),
      replace: String(r?.replace ?? ""),
    }));
    return JSON.stringify(stable);
  }

  async function syncVcardOutputCleanerFromActivePreset({ settings } = {}) {
    ui.lastError = "";
    try {
      const s = settings && typeof settings === "object" ? settings : await getApiV1Settings();
      const currentEnabled =
        s?.vcard?.outputCleaner?.config?.enabled === undefined ? true : Boolean(s?.vcard?.outputCleaner?.config?.enabled);

      const rulesFromPreset = buildOutputCleanerRulesFromPreset(activePreset.value);
      const fallback = defaultOutputCleanerConfig();
      const nextRules = rulesFromPreset.length ? rulesFromPreset : (Array.isArray(fallback?.rules) ? fallback.rules : []);

      const currentRules = s?.vcard?.outputCleaner?.config?.rules;
      if (stableRuleListKey(currentRules) === stableRuleListKey(nextRules)) return;

      await patchApiV1Settings({ vcard: { outputCleaner: { config: { version: "v1", enabled: currentEnabled, rules: nextRules } } } });
    } catch (err) {
      ui.lastError = `同步 VCard 清洗规则失败：${String(err?.message || err)}`;
    }
  }

  function toNumberOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function buildPresetSnapshot(preset) {
    const p = preset && typeof preset === "object" ? preset : {};
    return {
      temperature: toNumberOrNull(p.temperature),
      top_p: toNumberOrNull(p.top_p),
      top_k: toNumberOrNull(p.top_k),
      openai_max_tokens: toNumberOrNull(p.openai_max_tokens),
      squash_system_messages: Boolean(p.squash_system_messages),
      wrap_in_quotes: Boolean(p.wrap_in_quotes),
      claude_use_sysprompt: Boolean(p.claude_use_sysprompt),
      use_makersuite_sysprompt: Boolean(p.use_makersuite_sysprompt),
      role_card_in_chat_history: p.role_card_in_chat_history === undefined ? true : Boolean(p.role_card_in_chat_history),
    };
  }

  function isPresetSame(a, b) {
    return JSON.stringify(buildPresetSnapshot(a)) === JSON.stringify(buildPresetSnapshot(b));
  }

  const presetDirty = computed(() => !isPresetSame(activePreset.value, activePresetBaseRef.value));
  const presetIsBuiltin = computed(() => String(selectedPresetName.value || "") === BUILTIN_DEFAULT_PRESET.name);
  const presetSaveDisabled = computed(() => presetIsBuiltin.value || presetSaving.value || !presetDirty.value);
  const presetSaveHint = computed(() => {
    if (presetSaving.value) return "保存中…";
    if (presetDirty.value) return "未保存";
    if (presetSavedAt.value) return "已保存";
    return "";
  });

  watch(
    () => presetDirty.value,
    (dirty) => {
      if (!dirty) return;
      presetSavedAt.value = 0;
      presetSaveError.value = "";
    },
  );
  const activeProvider = computed(() => normalizeProvider(api.providerOverride || activePreset.value?.chat_completion_source));
  const activeModel = computed(() => api.modelOverride || pickModelFromPreset(activePreset.value, activeProvider.value) || "gpt-4o-mini");
  const activeConnection = computed(() => api.providers?.[activeProvider.value] || { baseUrl: "", key: "" });
  const useSystemPrompt = computed(() => pickUseSystemPromptFromPreset(activePreset.value, activeProvider.value));

  const previewMessages = computed(() =>
    buildMessages({
      preset: activePreset.value,
      ctx,
      chat: chat.value,
      userInput: userInput.value.trim() || "（预览）",
      useSystemPrompt: useSystemPrompt.value,
    }),
  );

  async function refreshActivePreset() {
    try {
      const out = await getApiV1PresetByName(selectedPresetName.value);
      const preset = cloneJson(out?.preset || BUILTIN_DEFAULT_PRESET);
      activePresetRef.value = preset;
      activePresetBaseRef.value = cloneJson(preset);
      presetSavedAt.value = 0;
    } catch {
      const preset = cloneJson(BUILTIN_DEFAULT_PRESET);
      activePresetRef.value = preset;
      activePresetBaseRef.value = cloneJson(preset);
      presetSavedAt.value = 0;
    }
  }

  async function refreshSettingsAndPresets() {
    const [settings, presetList] = await Promise.all([getApiV1Settings(), listApiV1Presets()]);

    selectedPresetName.value = String(settings?.selectedPresetName || BUILTIN_DEFAULT_PRESET.name);
    if (settings?.ctx && typeof settings.ctx === "object") Object.assign(ctx, settings.ctx);

    ui.stream = Boolean(settings?.ui?.stream);
    ui.reasoningEffort = String(settings?.ui?.reasoningEffort || "auto");
    ui.includeReasoning = Boolean(settings?.ui?.includeReasoning);

    api.providerOverride = String(settings?.apiNonSensitive?.providerOverride || "");
    api.modelOverride = String(settings?.apiNonSensitive?.modelOverride || "");

    const p = settings?.apiNonSensitive?.providers || {};
    api.providers.openai.baseUrl = String(p?.openai?.baseUrl || api.providers.openai.baseUrl || "");
    api.providers.claude.baseUrl = String(p?.claude?.baseUrl || api.providers.claude.baseUrl || "");
    api.providers.makersuite.baseUrl = String(p?.makersuite?.baseUrl || api.providers.makersuite.baseUrl || "");
    api.providers.vertexai.baseUrl = String(p?.vertexai?.baseUrl || api.providers.vertexai.baseUrl || "");
    api.providers.vertexai.region = String(p?.vertexai?.region || api.providers.vertexai.region || "us-central1");
    api.providers.vertexai.projectId = String(p?.vertexai?.projectId || api.providers.vertexai.projectId || "");

    presets.value = toPresetNameList(presetList?.presets || []);
    await refreshActivePreset();
    await syncVcardOutputCleanerFromActivePreset({ settings });
  }

  function buildPresetPatch(preset) {
    const p = preset && typeof preset === "object" ? preset : {};
    return {
      temperature: Number(p.temperature),
      top_p: Number(p.top_p),
      top_k: Number(p.top_k),
      openai_max_tokens: Number(p.openai_max_tokens),
      squash_system_messages: Boolean(p.squash_system_messages),
      wrap_in_quotes: Boolean(p.wrap_in_quotes),
      claude_use_sysprompt: Boolean(p.claude_use_sysprompt),
      use_makersuite_sysprompt: Boolean(p.use_makersuite_sysprompt),
      role_card_in_chat_history: p.role_card_in_chat_history === undefined ? true : Boolean(p.role_card_in_chat_history),
    };
  }

  async function saveActivePreset() {
    presetSaveError.value = "";
    if (presetSaving.value) return;
    if (presetIsBuiltin.value) {
      presetSaveError.value = "内置默认预设不可修改，请先导入/复制为新预设。";
      return;
    }
    if (!presetDirty.value) return;

    presetSaving.value = true;
    try {
      const name = String(selectedPresetName.value || "");
      const patch = buildPresetPatch(activePreset.value);
      const out = await patchApiV1PresetByName(name, patch);
      const saved = cloneJson(out?.preset || activePreset.value);
      activePresetRef.value = saved;
      activePresetBaseRef.value = cloneJson(saved);
      const savedAt = Date.now();
      presetSavedAt.value = savedAt;
      setTimeout(() => {
        if (presetSavedAt.value !== savedAt) return;
        if (presetDirty.value) return;
        presetSavedAt.value = 0;
      }, 2000);
    } catch (err) {
      presetSaveError.value = `保存失败：${String(err?.message || err)}`;
    } finally {
      presetSaving.value = false;
    }
  }

  async function ensureThread() {
    const id = normalizeText(threadId.value);
    if (id) {
      try {
        await getApiV1ChatThread(id);
        return id;
      } catch {
        // ignore and recreate
      }
    }

    const out = await createApiV1ChatThread({ presetName: selectedPresetName.value, ctx });
    const nextId = String(out?.thread?.threadId || "");
    threadId.value = nextId;
    writeThreadId(nextId);
    return nextId;
  }

  async function refreshChat() {
    const id = normalizeText(threadId.value);
    if (!id) return;
    const page = await listApiV1ChatThreadMessages(id, { limit: 200 });
    const items = Array.isArray(page?.items) ? page.items : [];
    chat.value = items.map((m) => ({ role: m.role, content: String(m.content || ""), time: toTimeLabel(m.createdAt) }));
  }

  async function syncThreadMeta() {
    const id = normalizeText(threadId.value);
    if (!id) return;
    await patchApiV1ChatThread(id, { presetName: selectedPresetName.value, ctx });
  }

  async function importPresetFromFile(file) {
    ui.lastError = "";
    debugState.value = null;
    try {
      const obj = JSON.parse(await file.text());
      await importApiV1Preset({ fileName: file.name, rawPreset: obj });
      await refreshSettingsAndPresets();
    } catch (err) {
      ui.lastError = `导入失败：${String(err?.message || err)}`;
    }
  }

  function resetToBuiltInDefault() {
    selectedPresetName.value = BUILTIN_DEFAULT_PRESET.name;
    ui.lastError = "";
    debugState.value = null;
  }

  function exportActivePreset() {
    const preset = activePreset.value;
    const blob = new Blob([JSON.stringify(preset, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${preset.name}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function removeActivePreset() {
    ui.lastError = "";
    debugState.value = null;
    const name = String(selectedPresetName.value || "");
    if (name === BUILTIN_DEFAULT_PRESET.name) return;

    try {
      await deleteApiV1PresetByName(name);
      selectedPresetName.value = BUILTIN_DEFAULT_PRESET.name;
      await refreshSettingsAndPresets();
    } catch (err) {
      ui.lastError = `删除失败：${String(err?.message || err)}`;
    }
  }

  async function clearChat() {
    ui.lastError = "";
    debugState.value = null;
    try {
      const id = await ensureThread();
      await clearApiV1ChatThreadMessages(id);
      chat.value = [];
    } catch (err) {
      ui.lastError = `清空失败：${String(err?.message || err)}`;
    }
  }

  const sendMessage = createChatSendMessage({
    ui,
    debugState,
    userInput,
    sending,
    chat,
    api,
    activePreset,
    activeProvider,
    activeConnection,
    ensureThread,
    syncThreadMeta,
    refreshChat,
  });

  onMounted(async () => {
    const sensitive = readApiSensitive();
    api.rememberKey = Boolean(sensitive?.rememberKey);
    api.providers.openai.key = api.rememberKey ? String(sensitive?.providers?.openai?.key || "") : "";
    api.providers.claude.key = api.rememberKey ? String(sensitive?.providers?.claude?.key || "") : "";
    api.providers.makersuite.key = api.rememberKey ? String(sensitive?.providers?.makersuite?.key || "") : "";
    api.providers.vertexai.key = api.rememberKey ? String(sensitive?.providers?.vertexai?.key || "") : "";

    try {
      await refreshSettingsAndPresets();
      await ensureThread();
      await refreshChat();
    } catch (err) {
      ui.lastError = `初始化失败：${String(err?.message || err)}`;
    } finally {
      booted.value = true;
    }
  });

  attachChatWatches({ selectedPresetName, ctx, ui, api, booted, patchApiV1Settings, refreshActivePreset, syncThreadMeta, syncVcardOutputCleanerFromActivePreset });

  return {
    presets,
    selectedPresetName,
    activePreset,
    activeProvider,
    activeModel,
    api,
    ctx,
    ui,
    chat,
    userInput,
    sending,
    previewMessages,
    debugState,
    presetDirty,
    presetIsBuiltin,
    presetSaving,
    presetSaveDisabled,
    presetSaveHint,
    presetSaveError,
    importPresetFromFile,
    resetToBuiltInDefault,
    exportActivePreset,
    saveActivePreset,
    removeActivePreset,
    clearChat,
    sendMessage,
  };
}
