/**
 * 文件：sqliteAppSettingsRepository.js
 * 模块：server/adapters/gateways
 * 作用：全局设置仓储（SQLite：app_settings；单机单用户，固定 id=1）
 * 依赖：server/shared/apiError、server/shared/errorCodes
 * @created 2026-01-11
 * @modified 2026-01-11
 */

import fs from "node:fs/promises";

import { ApiError } from "../../shared/apiError.js";
import { ERROR_CODES } from "../../shared/errorCodes.js";

import { defaultOutputCleanerConfig, normalizeOutputCleanerConfig } from "../../entities/vcard/outputCleaner.js";

const DEFAULT_VCARD_PROMPT_PACK_MVU_TEMPLATE_URL = new URL("../../../src/modules/vcard/assets/promptPacks/mvuVariablesTemplate.txt", import.meta.url);

function nowIso() {
  return new Date().toISOString();
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
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

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeBool(value) {
  return Boolean(value);
}

function toStringOr(value, fallback) {
  const s = normalizeText(value);
  return s || String(fallback || "");
}

function toNonEmptyStringOrNull(value) {
  const s = normalizeText(value);
  return s.length > 0 ? s : null;
}

function normalizeCtx(raw) {
  const obj = isPlainObject(raw) ? raw : {};
  return {
    user: toStringOr(obj.user, ""),
    char: toStringOr(obj.char, ""),
    personaDescription: toStringOr(obj.personaDescription, ""),
    charDescription: toStringOr(obj.charDescription, ""),
    charPersonality: toStringOr(obj.charPersonality, ""),
    scenario: toStringOr(obj.scenario, ""),
    worldInfoBefore: toStringOr(obj.worldInfoBefore, ""),
    worldInfoAfter: toStringOr(obj.worldInfoAfter, ""),
    dialogueExamples: toStringOr(obj.dialogueExamples, ""),
  };
}

function normalizeUi(raw) {
  const obj = isPlainObject(raw) ? raw : {};
  return {
    stream: normalizeBool(obj.stream),
    reasoningEffort: toStringOr(obj.reasoningEffort, "auto"),
    includeReasoning: normalizeBool(obj.includeReasoning),
  };
}

function normalizeProviderConn(provider, raw) {
  const obj = isPlainObject(raw) ? raw : {};
  const baseUrl = toStringOr(obj.baseUrl, "");
  if (provider === "vertexai") {
    return { baseUrl, region: toStringOr(obj.region, "us-central1"), projectId: toStringOr(obj.projectId, "") };
  }
  return { baseUrl };
}

function normalizeApiNonSensitive(raw) {
  const obj = isPlainObject(raw) ? raw : {};
  const providers = isPlainObject(obj.providers) ? obj.providers : {};
  return {
    providerOverride: toStringOr(obj.providerOverride, ""),
    modelOverride: toStringOr(obj.modelOverride, ""),
    providers: {
      openai: normalizeProviderConn("openai", providers.openai),
      claude: normalizeProviderConn("claude", providers.claude),
      makersuite: normalizeProviderConn("makersuite", providers.makersuite),
      vertexai: normalizeProviderConn("vertexai", providers.vertexai),
    },
  };
}

function newTemplateId() {
  return `tpl_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizePromptPackTemplate(raw) {
  const obj = isPlainObject(raw) ? raw : {};
  const content = String(obj.content || "").replace(/\r\n/g, "\n");
  return {
    id: String(obj.id || "") || newTemplateId(),
    name: String(obj.name || ""),
    enabled: obj.enabled === undefined ? true : Boolean(obj.enabled),
    content,
  };
}

function normalizePromptPackTemplates(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list.map(normalizePromptPackTemplate);
}

function normalizeVcardPromptPack(raw) {
  const obj = isPlainObject(raw) ? raw : {};
  return {
    enabled: obj.enabled === undefined ? true : Boolean(obj.enabled),
    templatesWorldInfoBefore: normalizePromptPackTemplates(obj.templatesWorldInfoBefore),
  };
}

function normalizeVcardOutputCleaner(raw) {
  const obj = isPlainObject(raw) ? raw : {};
  const cfgRaw = isPlainObject(obj.config) ? obj.config : defaultOutputCleanerConfig();
  const cfg = normalizeOutputCleanerConfig(cfgRaw);
  return {
    writeBack: obj.writeBack === undefined ? true : Boolean(obj.writeBack),
    config: cfg,
  };
}

function normalizeStringArray(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((x) => String(x ?? "").trim())
    .filter((x) => x.length > 0);
}

function normalizeVcardWorkflow(raw) {
  const obj = isPlainObject(raw) ? raw : {};
  const modeRaw = normalizeText(obj.mode || "");
  return { mode: modeRaw === "free" ? "free" : "task" };
}

function normalizeReviewPolicy(value, fallback) {
  const t = normalizeText(value);
  if (t === "auto" || t === "manual") return t;
  return fallback;
}

function normalizeVcardReview(raw) {
  const obj = isPlainObject(raw) ? raw : {};
  return {
    patchReview: normalizeReviewPolicy(obj.patchReview, "auto"),
    planReview: normalizeReviewPolicy(obj.planReview, "manual"),
  };
}

const VCARD_SOUND_TRIGGERS_ALLOWED = new Set(["plan_review", "ask_user", "all_done"]);
const DEFAULT_VCARD_SOUND_TRIGGERS = Object.freeze(["plan_review", "ask_user", "all_done"]);

function normalizeVcardSound(raw) {
  const obj = isPlainObject(raw) ? raw : {};
  const enabled = obj.enabled === undefined ? true : Boolean(obj.enabled);
  const triggers = normalizeStringArray(obj.triggers).filter((t) => VCARD_SOUND_TRIGGERS_ALLOWED.has(t));
  return { enabled, triggers: triggers.length ? triggers : DEFAULT_VCARD_SOUND_TRIGGERS.slice() };
}

function normalizeVcardNotifications(raw) {
  const obj = isPlainObject(raw) ? raw : {};
  return { sound: normalizeVcardSound(obj.sound) };
}

function normalizeVcardHumanizeErrors(raw) {
  const obj = isPlainObject(raw) ? raw : {};
  return { enabled: obj.enabled === undefined ? true : Boolean(obj.enabled), showDetails: obj.showDetails === undefined ? true : Boolean(obj.showDetails) };
}

function normalizeVcardErrors(raw) {
  const obj = isPlainObject(raw) ? raw : {};
  return { humanize: normalizeVcardHumanizeErrors(obj.humanize) };
}

function normalizeVcardSettings(raw) {
  const obj = isPlainObject(raw) ? raw : {};
  return {
    workflow: normalizeVcardWorkflow(obj.workflow),
    review: normalizeVcardReview(obj.review),
    notifications: normalizeVcardNotifications(obj.notifications),
    errors: normalizeVcardErrors(obj.errors),
    promptPack: normalizeVcardPromptPack(obj.promptPack),
    outputCleaner: normalizeVcardOutputCleaner(obj.outputCleaner),
  };
}

async function loadDefaultMvuVariablesTemplateText() {
  try {
    const text = await fs.readFile(DEFAULT_VCARD_PROMPT_PACK_MVU_TEMPLATE_URL, "utf8");
    return String(text || "").replace(/\r\n/g, "\n").trim();
  } catch {
    return "";
  }
}

function mergeShallow(base, patch) {
  const b = isPlainObject(base) ? base : {};
  const p = isPlainObject(patch) ? patch : {};
  return { ...b, ...p };
}

function mergeProviders(baseProviders, patchProviders) {
  const b = isPlainObject(baseProviders) ? baseProviders : {};
  const p = isPlainObject(patchProviders) ? patchProviders : {};
  return {
    openai: mergeShallow(b.openai, p.openai),
    claude: mergeShallow(b.claude, p.claude),
    makersuite: mergeShallow(b.makersuite, p.makersuite),
    vertexai: mergeShallow(b.vertexai, p.vertexai),
  };
}

function buildDefaultSettings() {
  return {
    selectedPresetName: "默认（内置）",
    ctx: normalizeCtx({}),
    ui: normalizeUi({ stream: false, reasoningEffort: "auto", includeReasoning: false }),
    apiNonSensitive: normalizeApiNonSensitive({
      providerOverride: "",
      modelOverride: "",
      providers: {
        openai: { baseUrl: "http://localhost:11434/v1" },
        claude: { baseUrl: "" },
        makersuite: { baseUrl: "" },
        vertexai: { baseUrl: "", region: "us-central1", projectId: "" },
      },
    }),
    vcard: normalizeVcardSettings({}),
  };
}

async function ensureRow(db) {
  const row = await db.get("SELECT id FROM app_settings WHERE id = 1");
  if (row) return;

  const defaults = buildDefaultSettings();
  const mvuText = await loadDefaultMvuVariablesTemplateText();
  if (mvuText)
    defaults.vcard = normalizeVcardSettings({ ...(defaults.vcard || {}), promptPack: { ...(defaults.vcard?.promptPack || {}), templatesWorldInfoBefore: [{ id: "t0_mvu_variables", name: "MVU 变量框架（test.txt）", enabled: true, content: mvuText }] } });
  const at = nowIso();
  await db.run(
    "INSERT INTO app_settings (id, selected_preset_name, ctx_json, ui_json, api_json, vcard_json, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?, ?)",
    [
      toNonEmptyStringOrNull(defaults.selectedPresetName),
      safeJsonStringify(defaults.ctx),
      safeJsonStringify(defaults.ui),
      safeJsonStringify(defaults.apiNonSensitive),
      safeJsonStringify(defaults.vcard),
      at,
      at,
    ],
  );
}

function toSettingsFromRow(row) {
  if (!row) return null;

  const selectedPresetName = toStringOr(row.selected_preset_name, "默认（内置）");
  const ctx = normalizeCtx(safeJsonParse(row.ctx_json));
  const ui = normalizeUi(safeJsonParse(row.ui_json));
  const apiNonSensitive = normalizeApiNonSensitive(safeJsonParse(row.api_json));
  const vcard = normalizeVcardSettings(safeJsonParse(row.vcard_json));

  return {
    selectedPresetName,
    ctx,
    ui,
    apiNonSensitive,
    vcard,
    createdAt: toStringOr(row.created_at, ""),
    updatedAt: toStringOr(row.updated_at, ""),
  };
}

/**
 * 中文注释：
 * createSqliteAppSettingsRepository(db)
 * 作用：创建全局设置仓储（单行表 app_settings）
 * 约束：固定使用 id=1；apiKey 不落库，只保存非敏感配置
 * 参数：
 *  - db: any（openSqliteDb 返回值）
 * 返回：{ getSettings, updateSettings }
 */
export function createSqliteAppSettingsRepository(db) {
  if (!db) throw new Error("db 不能为空。");

  const getSettings = async () => {
    await db.transaction(async () => ensureRow(db));
    const row = await db.get("SELECT * FROM app_settings WHERE id = 1");
    const settings = toSettingsFromRow(row);
    if (!settings) throw new ApiError({ httpStatus: 500, code: ERROR_CODES.SETTINGS_NOT_FOUND, message: "settings 缺失。" });
    return settings;
  };

  const updateSettings = async (patch) => {
    const current = await getSettings();

    const nextSelected = toStringOr(patch?.selectedPresetName, current.selectedPresetName);
    const nextCtx = normalizeCtx(mergeShallow(current.ctx, patch?.ctx));
    const nextUi = normalizeUi(mergeShallow(current.ui, patch?.ui));

    const apiPatched = isPlainObject(patch?.apiNonSensitive) ? patch.apiNonSensitive : {};
    const mergedApi = {
      ...mergeShallow(current.apiNonSensitive, apiPatched),
      providers: mergeProviders(current.apiNonSensitive.providers, apiPatched.providers),
    };
    const nextApi = normalizeApiNonSensitive(mergedApi);

    const vcardPatched = isPlainObject(patch?.vcard) ? patch.vcard : {};
    const mergedVcard = {
      ...mergeShallow(current.vcard, vcardPatched),
      workflow: mergeShallow(current.vcard?.workflow, vcardPatched.workflow),
      review: mergeShallow(current.vcard?.review, vcardPatched.review),
      notifications: {
        ...mergeShallow(current.vcard?.notifications, vcardPatched.notifications),
        sound: mergeShallow(current.vcard?.notifications?.sound, vcardPatched.notifications?.sound),
      },
      errors: {
        ...mergeShallow(current.vcard?.errors, vcardPatched.errors),
        humanize: mergeShallow(current.vcard?.errors?.humanize, vcardPatched.errors?.humanize),
      },
      promptPack: mergeShallow(current.vcard?.promptPack, vcardPatched.promptPack),
      outputCleaner: mergeShallow(current.vcard?.outputCleaner, vcardPatched.outputCleaner),
    };
    const nextVcard = normalizeVcardSettings(mergedVcard);

    const at = nowIso();
    await db.run("UPDATE app_settings SET selected_preset_name = ?, ctx_json = ?, ui_json = ?, api_json = ?, vcard_json = ?, updated_at = ? WHERE id = 1", [
      toNonEmptyStringOrNull(nextSelected),
      safeJsonStringify(nextCtx),
      safeJsonStringify(nextUi),
      safeJsonStringify(nextApi),
      safeJsonStringify(nextVcard),
      at,
    ]);

    return { ...current, selectedPresetName: nextSelected, ctx: nextCtx, ui: nextUi, apiNonSensitive: nextApi, vcard: nextVcard, updatedAt: at };
  };

  return { getSettings, updateSettings };
}
