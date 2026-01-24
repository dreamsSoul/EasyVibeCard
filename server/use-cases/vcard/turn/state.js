/**
 * 文件：state.js
 * 模块：server/use-cases/vcard/turn
 * 作用：Turn 输入归一化、草稿加载与消息构建（不含 read-loop）
 * 依赖：server/shared、normalize
 * @created 2026-01-07
 * @modified 2026-01-21
 */

import { ApiError } from "../../../shared/apiError.js";
import { ERROR_CODES } from "../../../shared/errorCodes.js";
import { maskApiKey } from "../../../shared/mask.js";

import { BUILTIN_DEFAULT_PRESET } from "../../../entities/presets/builtinDefaultPreset.js";
import { buildMessages } from "../../../entities/presets/buildMessages.js";
import { normalizeProvider, pickModelFromPreset, pickUseSystemPromptFromPreset } from "../../../entities/presets/providerUtils.js";

import { applyOutputCleaner } from "../../../entities/vcard/outputCleaner.js";
import { applyPromptPackToCtx } from "../../../entities/vcard/promptPack.js";
import { buildVcardAutoFullText } from "../../../entities/vcard/readProtocol/fullText.js";
import { normalizeVibePlan, pickVibePlanCurrent } from "../../../entities/vcard/vibePlan.js";

import { isPlainObject, normalizeProviderOptions, normalizeRequestId, normalizeText } from "./normalize.js";
import { buildVcardContextText, buildVcardControlText } from "./messages.js";
import { IDEMPOTENCY_KIND_VCARD_TURN_USER_TEXT } from "./constants.js";

function normalizeIntent(value) {
  const t = normalizeText(value);
  if (t === "retry" || t === "continue") return t;
  return "run";
}

function normalizeReadContinuation(value) {
  const obj = isPlainObject(value) ? value : null;
  if (!obj) return null;

  // 新格式：把 read-loop 的读取内容注入 worldInfoAfter（而不是把 read_result 追加到 messages[] 尾部）
  const worldInfoAfterAppend = String(obj.worldInfoAfterAppend ?? "")
    .trim()
    .slice(0, 120000);

  // 兼容旧格式：前端可能仍回传 injectedAssistantTexts（read_result 文本数组）
  const injectedAssistantTexts = (Array.isArray(obj.injectedAssistantTexts) ? obj.injectedAssistantTexts : [])
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((x) => x.slice(0, 20000));

  const legacyAppend = injectedAssistantTexts.length > 0 ? injectedAssistantTexts.join("\n\n").trim() : "";

  const merged = [worldInfoAfterAppend, legacyAppend].map((x) => String(x || "").trim()).filter(Boolean).join("\n\n").trim();
  if (!merged) return null;
  return { worldInfoAfterAppend: merged };
}

function isAbortSignal(value) {
  return Boolean(value && typeof value === "object" && typeof value.aborted === "boolean" && typeof value.addEventListener === "function");
}

export function normalizeTurnInput(input) {
  const draftId = normalizeText(input?.draftId);
  const baseVersion = Number(input?.baseVersion);
  const requestIdRaw = normalizeText(input?.requestId);
  const provided = input?.__requestIdProvided === true;
  const clientRequestId = provided ? requestIdRaw : "";
  const requestId = normalizeRequestId(requestIdRaw);

  const runId = normalizeText(input?.runId);
  const turnIndex = (() => {
    const n = Number(input?.turnIndex);
    if (!Number.isFinite(n)) return null;
    const i = Math.trunc(n);
    return i > 0 ? i : null;
  })();

  const presetName = normalizeText(input?.presetName);
  const preset = isPlainObject(input?.preset) ? input.preset : null;
  const model = normalizeText(input?.model || "");
  const intent = normalizeIntent(input?.intent);
  const readContinuation = normalizeReadContinuation(input?.readContinuation);
  const abortSignal = isAbortSignal(input?.abortSignal) ? input.abortSignal : null;

  return {
    draftId,
    baseVersion,
    clientRequestId,
    requestId,
    runId,
    turnIndex,
    requestedMode: normalizeText(input?.mode || "auto"),
    model,
    presetName,
    preset,
    reason: normalizeText(input?.reason),
    userText: normalizeText(input?.userText),
    intent,
    readContinuation,
    ctx: isPlainObject(input?.ctx) ? input.ctx : {},
    upstream: isPlainObject(input?.upstream) ? input.upstream : {},
    providerOptions: normalizeProviderOptions(input?.providerOptions),
    stream: Boolean(input?.stream),
    abortSignal,
  };
}

export async function ensureDraftAndVersion(draftRepo, draftId, baseVersion) {
  if (!draftId) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "draftId 不能为空。" });
  if (!Number.isFinite(baseVersion) || baseVersion < 1) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "baseVersion 非法。" });

  const meta = await draftRepo.getDraftMeta({ draftId });
  if (!meta) throw new ApiError({ httpStatus: 404, code: ERROR_CODES.DRAFT_NOT_FOUND, message: "草稿不存在。" });
  if (baseVersion !== meta.headVersion) {
    throw new ApiError({
      httpStatus: 409,
      code: ERROR_CODES.VERSION_CONFLICT,
      message: "baseVersion 与 latestVersion 不一致。",
      details: { baseVersion, latestVersion: meta.headVersion },
    });
  }

  const current = await draftRepo.getDraft({ draftId });
  if (!current?.snapshot) throw new Error("草稿快照缺失。");
  return current.snapshot;
}

export function buildDebugUpstream(upstream) {
  return {
    provider: normalizeText(upstream?.provider) || "openai",
    baseUrl: normalizeText(upstream?.baseUrl),
    apiKeyMasked: maskApiKey(upstream?.apiKey),
    region: normalizeText(upstream?.region),
    projectId: upstream?.projectId ? "***" : "",
  };
}

export async function loadRecentChat(chatRepo, draftId) {
  const page = await chatRepo.getDraftChatPage({ draftId, beforeSeq: null, limit: 16 });
  const items = Array.isArray(page?.items) ? page.items : [];
  return items.map((m) => ({ role: m.role, content: String(m.content || "") }));
}

function toStringOr(value, fallback) {
  const s = normalizeText(value);
  return s || String(fallback || "");
}

function normalizeCtxMerged(base, patch) {
  const b = isPlainObject(base) ? base : {};
  const p = isPlainObject(patch) ? patch : {};
  return {
    user: toStringOr(p.user, b.user),
    char: toStringOr(p.char, b.char),
    personaDescription: toStringOr(p.personaDescription, b.personaDescription),
    charDescription: toStringOr(p.charDescription, b.charDescription),
    charPersonality: toStringOr(p.charPersonality, b.charPersonality),
    scenario: toStringOr(p.scenario, b.scenario),
    worldInfoBefore: toStringOr(p.worldInfoBefore, b.worldInfoBefore),
    worldInfoAfter: toStringOr(p.worldInfoAfter, b.worldInfoAfter),
    dialogueExamples: toStringOr(p.dialogueExamples, b.dialogueExamples),
  };
}

async function loadPresetOrThrow(presetRepo, presetName) {
  const name = normalizeText(presetName);
  if (!name) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "presetName 不能为空。" });
  if (name === normalizeText(BUILTIN_DEFAULT_PRESET.name)) return BUILTIN_DEFAULT_PRESET;
  if (!presetRepo?.getPresetByName) throw new Error("presetRepo.getPresetByName 缺失。");
  const row = await presetRepo.getPresetByName({ name });
  if (!row?.preset) throw new ApiError({ httpStatus: 404, code: ERROR_CODES.PRESET_NOT_FOUND, message: "预设不存在。" });
  return row.preset;
}

function buildUpstreamFromInput({ settings, provider, upstreamInput }) {
  const upstream = isPlainObject(upstreamInput) ? upstreamInput : {};
  const providers = settings?.apiNonSensitive?.providers;
  const conn = providers && typeof providers === "object" ? providers?.[provider] : null;
  const baseUrl = normalizeText(upstream.baseUrl || conn?.baseUrl || "");
  const apiKey = normalizeText(upstream.apiKey || "");
  if (provider === "vertexai") {
    const region = normalizeText(upstream.region || conn?.region || "");
    const projectId = normalizeText(upstream.projectId || conn?.projectId || "");
    return { provider, baseUrl, apiKey, region, projectId };
  }
  return { provider, baseUrl, apiKey };
}

function buildProviderOptions({ settings, preset, provider, requestProviderOptions }) {
  const ui = settings?.ui && typeof settings.ui === "object" ? settings.ui : {};
  const req = isPlainObject(requestProviderOptions) ? requestProviderOptions : {};
  const base = {
    useSystemPrompt: pickUseSystemPromptFromPreset(preset, provider),
    reasoningEffort: normalizeText(ui.reasoningEffort || "auto") || "auto",
    includeReasoning: Boolean(ui.includeReasoning),
    upstreamStream: false,
  };
  return {
    useSystemPrompt: req.useSystemPrompt === undefined ? base.useSystemPrompt : Boolean(req.useSystemPrompt),
    reasoningEffort: req.reasoningEffort === undefined ? base.reasoningEffort : normalizeText(req.reasoningEffort || "auto") || "auto",
    includeReasoning: req.includeReasoning === undefined ? base.includeReasoning : Boolean(req.includeReasoning),
    upstreamStream: req.upstreamStream === undefined ? base.upstreamStream : Boolean(req.upstreamStream),
  };
}

/**
 * 中文注释：
 * resolveVcardTurnConfig({ presetRepo, settingsRepo, normalized })
 * 作用：解析 preset/ctx/provider/model/providerOptions（支持 presetName；兼容传入 preset 对象）
 * 约束：OpenAI provider 必须有 baseUrl（可从 settings 补齐）；apiKey 不落库，只随请求使用
 * 返回：Promise<{ preset, ctx, upstream, providerOptions, model }>
 */
export async function resolveVcardTurnConfig({ presetRepo, settingsRepo, normalized }) {
  const settings = settingsRepo?.getSettings ? await settingsRepo.getSettings() : { selectedPresetName: BUILTIN_DEFAULT_PRESET.name, ctx: {}, ui: {}, apiNonSensitive: {} };

  const preset =
    normalized?.preset && typeof normalized.preset === "object"
      ? normalized.preset
      : await loadPresetOrThrow(presetRepo, normalized?.presetName || settings?.selectedPresetName || BUILTIN_DEFAULT_PRESET.name);

  const provider = (() => {
    const requested = normalizeText(normalized?.upstream?.provider);
    if (requested) return normalizeProvider(requested);
    const override = normalizeText(settings?.apiNonSensitive?.providerOverride);
    if (override) return normalizeProvider(override);
    return normalizeProvider(preset?.chat_completion_source);
  })();

  const model =
    normalizeText(normalized?.model) ||
    normalizeText(settings?.apiNonSensitive?.modelOverride) ||
    normalizeText(pickModelFromPreset(preset, provider)) ||
    "gpt-4o-mini";

  const ctx = normalizeCtxMerged(settings?.ctx, normalized?.ctx);
  const upstream = buildUpstreamFromInput({ settings, provider, upstreamInput: normalized?.upstream });
  if (provider === "openai" && !normalizeText(upstream.baseUrl)) {
    throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "OpenAI Base URL 不能为空。" });
  }

  const providerOptions = buildProviderOptions({ settings, preset, provider, requestProviderOptions: normalized?.providerOptions });
  const vcard = settings?.vcard && typeof settings.vcard === "object" ? settings.vcard : {};
  return { preset, ctx, upstream, providerOptions, model, provider, vcard };
}

function mergeWorldInfoAfter(ctx, appendText) {
  const base = isPlainObject(ctx) ? ctx : {};
  const extra = String(appendText || "").trim();
  if (!extra) return base;
  const prev = String(base.worldInfoAfter || "").trim();
  return { ...base, worldInfoAfter: prev ? `${prev}\n\n${extra}` : extra };
}

function pickPromptOrderEntry(promptOrders) {
  const list = Array.isArray(promptOrders) ? promptOrders : [];
  let idx = list.findIndex((x) => x && typeof x === "object" && Number(x.character_id) === 100001);
  if (idx >= 0) return { idx, entry: list[idx] };
  idx = list.findIndex((x) => x && typeof x === "object" && Number(x.character_id) === 100000);
  if (idx >= 0) return { idx, entry: list[idx] };
  return { idx: -1, entry: null };
}

function ensureWorldInfoBeforeMarkerEnabled(preset) {
  const p = preset && typeof preset === "object" ? preset : {};
  const prompts = Array.isArray(p.prompts) ? p.prompts.slice() : [];
  const hasWiBeforePrompt = prompts.some((x) => x && typeof x === "object" && String(x.identifier) === "worldInfoBefore");
  if (!hasWiBeforePrompt) {
    prompts.push({ name: "World Info (before)", identifier: "worldInfoBefore", marker: true, system_prompt: true, role: "system", content: "" });
  }

  const prompt_order = Array.isArray(p.prompt_order) ? p.prompt_order.map((x) => ({ ...x, order: Array.isArray(x?.order) ? x.order.map((y) => ({ ...y })) : [] })) : [];
  const picked = pickPromptOrderEntry(prompt_order);
  if (picked.idx >= 0) {
    const order = Array.isArray(picked.entry?.order) ? picked.entry.order.slice() : [];
    const foundIdx = order.findIndex((x) => x && typeof x === "object" && String(x.identifier) === "worldInfoBefore");
    if (foundIdx >= 0) {
      order[foundIdx] = { ...order[foundIdx], enabled: true };
    } else {
      const mainIdx = order.findIndex((x) => x && typeof x === "object" && String(x.identifier) === "main");
      const insertAt = mainIdx >= 0 ? mainIdx + 1 : 0;
      order.splice(insertAt, 0, { identifier: "worldInfoBefore", enabled: true });
    }
    prompt_order[picked.idx] = { ...prompt_order[picked.idx], order };
  } else {
    prompt_order.push({ character_id: 100001, order: [{ identifier: "main", enabled: true }, { identifier: "worldInfoBefore", enabled: true }] });
  }

  return { ...p, prompts, prompt_order };
}

function pickBuildMessagesOrder(preset) {
  const list = Array.isArray(preset?.prompt_order) ? preset.prompt_order : [];
  const entry =
    list.find((x) => x && typeof x === "object" && Number(x.character_id) === 100001) ||
    list.find((x) => x && typeof x === "object" && Number(x.character_id) === 100000);
  return Array.isArray(entry?.order) ? entry.order : [];
}

function presetHasPromptIdentifier(preset, identifier) {
  const prompts = Array.isArray(preset?.prompts) ? preset.prompts : [];
  const id = String(identifier || "");
  return prompts.some((p) => p && typeof p === "object" && String(p.identifier) === id);
}

function isPromptOrderEnabled(order, identifier) {
  const list = Array.isArray(order) ? order : [];
  const id = String(identifier || "");
  const found = list.find((x) => x && typeof x === "object" && String(x.identifier) === id);
  if (!found) return false;
  return found.enabled === undefined ? true : Boolean(found.enabled);
}

function isWorldInfoBeforeMarkerEnabled(preset) {
  if (!presetHasPromptIdentifier(preset, "worldInfoBefore")) return false;
  const order = pickBuildMessagesOrder(preset);
  return isPromptOrderEnabled(order, "worldInfoBefore");
}

export function buildVcardTurnMessagesForModel({ preset, ctx, chat, ctrlText, contextText, worldInfoAfterAppend, useSystemPrompt, forceWorldInfoBeforeMarker }) {
  const mergedCtx = mergeWorldInfoAfter(ctx, worldInfoAfterAppend);
  const history = contextText ? [{ role: "user", content: contextText, noQuote: true }, ...(Array.isArray(chat) ? chat : [])] : Array.isArray(chat) ? chat : [];
  const shouldForceWiBefore = Boolean(forceWorldInfoBeforeMarker);
  const effectivePreset = shouldForceWiBefore && !isWorldInfoBeforeMarkerEnabled(preset) ? ensureWorldInfoBeforeMarkerEnabled(preset) : preset;
  const base = buildMessages({ preset: effectivePreset, ctx: mergedCtx, chat: history, userInput: "", useSystemPrompt });
  let out = Array.isArray(base) ? base.slice() : [];

  if (contextText && !out.some((m) => String(m?.content || "").trim() === String(contextText || "").trim())) {
    const insertAt = out.findIndex((m) => m?.role !== "system");
    const role = useSystemPrompt ? "system" : "user";
    out.splice(insertAt < 0 ? out.length : insertAt, 0, { role, content: contextText });
  }

  // 兜底：若预设未启用 worldInfoAfter marker（或缺失该 prompt），避免 read 注入丢失。
  const appendText = String(worldInfoAfterAppend || "").trim();
  const needle = appendText.length > 200 ? appendText.slice(0, 200) : appendText;
  if (appendText && needle && !out.some((m) => String(m?.content || "").includes(needle))) {
    const role = useSystemPrompt ? "system" : "user";
    out.push({ role, content: appendText });
  }

  out.push({ role: "user", content: ctrlText });
  return out;
}

function shouldApplyVcardOutputCleaner(vcard) {
  const cfg = vcard?.outputCleaner?.config;
  return Boolean(cfg && typeof cfg === "object" && cfg.enabled && Array.isArray(cfg.rules) && cfg.rules.length > 0);
}

function cleanChatForVcard(chat, vcard) {
  if (!shouldApplyVcardOutputCleaner(vcard)) return Array.isArray(chat) ? chat.slice() : [];
  const cfg = vcard.outputCleaner.config;
  const list = Array.isArray(chat) ? chat : [];
  return list.map((m) => {
    if (!m || m.role !== "assistant") return m;
    const res = applyOutputCleaner(String(m.content || ""), cfg);
    return res.changed ? { ...m, content: res.text } : m;
  });
}

function buildVibePlanTaskListText(snapshot) {
  const planRaw = snapshot?.raw?.dataExtensions?.vibePlan;
  if (!planRaw || typeof planRaw !== "object") return "";

  const plan = normalizeVibePlan(planRaw);
  const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
  if (tasks.length === 0) return "";

  const picked = pickVibePlanCurrent(plan);
  const currentId = picked.type === "ok" || picked.type === "blocked" ? String(picked.taskId || "") : "";
  const current = currentId ? tasks.find((t) => String(t?.id || "") === currentId) : null;

  const lines = [];
  lines.push("【VCARD_TODO】");
  if (currentId) lines.push(`当前：${String(current?.title || currentId)}（${currentId}）`);

  const limit = 24;
  for (const t of tasks.slice(0, limit)) {
    const id = String(t?.id || "").trim();
    const title = String(t?.title || id || "（未命名任务）").trim();
    const status = String(t?.status || "todo");
    const mark = status === "done" ? "x" : id && id === currentId ? ">" : " ";
    lines.push(`- [${mark}] ${title}${id ? ` (${id})` : ""}`);
  }
  if (tasks.length > limit) lines.push(`- ……（剩余 ${tasks.length - limit} 条）`);

  return lines.join("\n").trim();
}

function buildPromptPackFromVcardSettings(vcard) {
  const pp = vcard?.promptPack && typeof vcard.promptPack === "object" ? vcard.promptPack : {};
  if (!pp.enabled) return null;

  const templates = Array.isArray(pp.templatesWorldInfoBefore) ? pp.templatesWorldInfoBefore : [];
  const parts = templates
    .filter((t) => Boolean(t?.enabled))
    .map((t) => String(t?.content || "").trim())
    .filter(Boolean);

  const content = parts.join("\n\n").trim();
  const slots = content ? [{ target: "worldInfoBefore", strategy: "prepend", content }] : [];
  return { version: "v1", enabled: true, name: "VCard PromptPack（worldInfoBefore templates）", slots };
}

/**
 * 中文注释：
 * buildVcardTurnMessages({ chatRepo, normalized, snapshot, mode, preset, ctx, providerOptions })
 * 作用：按 ST preset 构建 messages，并注入 VCARD_CONTEXT 与 VCARD_CTRL
 * 约束：userText 会先落库为 chat 消息；ctrlText 不落库，仅作为本次请求尾部指令
 * 返回：Promise<{ messages:{role,content}[], turnPrompt:any }>
 */
async function appendUserChatTextIfNeeded({ chatRepo, idempotencyStore, normalized, taggedUserText }) {
  if (!chatRepo?.appendChatMessage) throw new Error("chatRepo.appendChatMessage 缺失。");

  const draftId = String(normalized?.draftId || "").trim();
  const clientRequestId = String(normalized?.clientRequestId || "").trim();
  const text = String(taggedUserText || "");

  // 仅在“客户端显式提供 requestId”时启用幂等：避免第一次请求写入 user 消息后失败，重试导致重复消息。
  if (!idempotencyStore?.get || !idempotencyStore?.setIfAbsent || !draftId || !clientRequestId) {
    await chatRepo.appendChatMessage({ draftId, role: "user", content: text });
    return;
  }

  const existed = await idempotencyStore.get({ draftId, requestId: clientRequestId, kind: IDEMPOTENCY_KIND_VCARD_TURN_USER_TEXT });
  if (existed?.appended === true) return;

  await chatRepo.appendChatMessage({ draftId, role: "user", content: text });
  await idempotencyStore.setIfAbsent({
    draftId,
    requestId: clientRequestId,
    kind: IDEMPOTENCY_KIND_VCARD_TURN_USER_TEXT,
    result: { appended: true },
  });
}

export async function buildVcardTurnMessages({ chatRepo, idempotencyStore, normalized, snapshot, mode, preset, ctx, providerOptions, vcard }) {
  if (normalized.userText) {
    const todo = buildVibePlanTaskListText(snapshot);
    const taggedUserText = todo ? `${todo}\n\n【USER_INPUT】\n${normalized.userText}` : `【USER_INPUT】\n${normalized.userText}`;
    await appendUserChatTextIfNeeded({ chatRepo, idempotencyStore, normalized, taggedUserText });
  }
  const chat = cleanChatForVcard(await loadRecentChat(chatRepo, normalized.draftId), vcard);
  const contextText = buildVcardContextText(snapshot, mode, vcard);
  const ctrlText = buildVcardControlText({ snapshot, mode, reason: normalized.reason, intent: normalized.intent, userText: normalized.userText, vcard });

  const injectedPack = buildPromptPackFromVcardSettings(vcard);
  const appliedPack = injectedPack ? applyPromptPackToCtx(ctx, injectedPack) : null;
  let effectiveCtx = appliedPack ? appliedPack.ctx : ctx;
  let forceWorldInfoBeforeMarker = Boolean(appliedPack?.appliedTargets?.includes("worldInfoBefore"));

  // 全文注入：直接给模型正文快照（尽量减少“读文件/反复确认”的回合）。
  // 说明：当前默认总是注入全文；若后续需要“超长不注入/截断”，再引入 tokenLimit 策略。
  const fullText = buildVcardAutoFullText(snapshot);
  if (fullText) {
    const fullPack = {
      version: "v1",
      enabled: true,
      name: "VCard FullText（worldInfoBefore）",
      slots: [{ target: "worldInfoBefore", strategy: "prepend", content: fullText }],
    };
    const appliedFull = applyPromptPackToCtx(effectiveCtx, fullPack);
    effectiveCtx = appliedFull.ctx;
    forceWorldInfoBeforeMarker = forceWorldInfoBeforeMarker || appliedFull.appliedTargets.includes("worldInfoBefore");
  }

  const worldInfoAfterAppend = String(normalized?.readContinuation?.worldInfoAfterAppend || "").trim();

  const turnPrompt = {
    preset,
    chat,
    ctrlText,
    contextText,
    ctx: effectiveCtx,
    worldInfoAfterAppend,
    useSystemPrompt: Boolean(providerOptions?.useSystemPrompt),
    forceWorldInfoBeforeMarker,
  };

  const messages = buildVcardTurnMessagesForModel(turnPrompt);
  return { messages, turnPrompt };
}
