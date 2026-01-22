/**
 * 文件：threadInteractors.js
 * 模块：server/use-cases/chatThreads
 * 作用：Chat Threads 用例（create/get/patch/messages/clear）
 * 依赖：server/shared/apiError、server/shared/errorCodes、server/entities/presets
 * @created 2026-01-11
 * @modified 2026-01-11
 */

import crypto from "node:crypto";

import { BUILTIN_DEFAULT_PRESET } from "../../entities/presets/builtinDefaultPreset.js";
import { ApiError } from "../../shared/apiError.js";
import { ERROR_CODES } from "../../shared/errorCodes.js";

function normalizeText(value) {
  return String(value ?? "").trim();
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function toStringOr(value, fallback) {
  const s = normalizeText(value);
  return s || String(fallback || "");
}

function normalizeName(value) {
  const s = normalizeText(value);
  if (!s) return "";
  return s.slice(0, 200);
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

async function assertPresetExists(presetRepo, presetName) {
  const n = normalizeText(presetName);
  if (!n) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "presetName 不能为空。" });
  if (n === normalizeText(BUILTIN_DEFAULT_PRESET.name)) return;

  const row = await presetRepo.getPresetByName({ name: n });
  if (row?.preset) return;
  throw new ApiError({ httpStatus: 404, code: ERROR_CODES.PRESET_NOT_FOUND, message: "预设不存在。" });
}

/**
 * 中文注释：
 * createChatThreadInteractor({ chatThreadRepo, presetRepo, settingsRepo, name, presetName, ctx })
 * 作用：创建聊天会话（线程）
 * 约束：presetName 缺省取 settings.selectedPresetName；ctx 缺省取 settings.ctx
 * 参数：
 *  - chatThreadRepo: { createThread }
 *  - presetRepo: { getPresetByName }
 *  - settingsRepo: { getSettings }
 * 返回：Promise<{ thread: {threadId,...} }>
 */
export async function createChatThreadInteractor({ chatThreadRepo, presetRepo, settingsRepo, name, presetName, ctx }) {
  if (!chatThreadRepo?.createThread) throw new Error("chatThreadRepo.createThread 缺失。");
  if (!presetRepo?.getPresetByName) throw new Error("presetRepo.getPresetByName 缺失。");
  if (!settingsRepo?.getSettings) throw new Error("settingsRepo.getSettings 缺失。");

  const settings = await settingsRepo.getSettings();
  const chosenPresetName = normalizeText(presetName) || normalizeText(settings?.selectedPresetName) || normalizeText(BUILTIN_DEFAULT_PRESET.name);
  await assertPresetExists(presetRepo, chosenPresetName);

  const mergedCtx = normalizeCtxMerged(settings?.ctx, ctx);
  const threadId = crypto.randomUUID();
  const thread = await chatThreadRepo.createThread({ threadId, name: normalizeName(name), presetName: chosenPresetName, ctx: mergedCtx });
  return { thread };
}

/**
 * 中文注释：
 * getChatThreadInteractor({ chatThreadRepo, threadId })
 * 作用：获取会话元信息
 * 约束：不存在则抛出 CHAT_THREAD_NOT_FOUND
 * 参数：
 *  - chatThreadRepo: { getThreadById }
 *  - threadId: string
 * 返回：Promise<{ thread }>
 */
export async function getChatThreadInteractor({ chatThreadRepo, threadId }) {
  if (!chatThreadRepo?.getThreadById) throw new Error("chatThreadRepo.getThreadById 缺失。");
  const id = normalizeText(threadId);
  const thread = await chatThreadRepo.getThreadById({ threadId: id });
  if (!thread) throw new ApiError({ httpStatus: 404, code: ERROR_CODES.CHAT_THREAD_NOT_FOUND, message: "会话不存在。" });
  return { thread };
}

/**
 * 中文注释：
 * patchChatThreadInteractor({ chatThreadRepo, presetRepo, threadId, name, presetName, ctx })
 * 作用：更新会话元信息（name/presetName/ctx）
 * 约束：ctx 为浅合并；presetName 变更时需存在
 * 返回：Promise<{ thread }>
 */
export async function patchChatThreadInteractor({ chatThreadRepo, presetRepo, threadId, name, presetName, ctx }) {
  if (!chatThreadRepo?.updateThreadById) throw new Error("chatThreadRepo.updateThreadById 缺失。");
  if (!presetRepo?.getPresetByName) throw new Error("presetRepo.getPresetByName 缺失。");

  const id = normalizeText(threadId);
  if (!id) throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "threadId 不能为空。" });

  const current = await chatThreadRepo.getThreadById({ threadId: id });
  if (!current) throw new ApiError({ httpStatus: 404, code: ERROR_CODES.CHAT_THREAD_NOT_FOUND, message: "会话不存在。" });

  const nextPresetName = presetName === undefined ? undefined : normalizeText(presetName);
  if (nextPresetName !== undefined) await assertPresetExists(presetRepo, nextPresetName);

  const mergedCtx = ctx === undefined ? undefined : normalizeCtxMerged(current.ctx, ctx);
  const thread = await chatThreadRepo.updateThreadById({
    threadId: id,
    name: name === undefined ? undefined : normalizeName(name),
    presetName: nextPresetName === undefined ? undefined : nextPresetName,
    ctx: mergedCtx,
  });

  if (!thread) throw new ApiError({ httpStatus: 404, code: ERROR_CODES.CHAT_THREAD_NOT_FOUND, message: "会话不存在。" });
  return { thread };
}

/**
 * 中文注释：
 * getChatThreadMessagesInteractor({ chatThreadRepo, threadId, beforeSeq, limit })
 * 作用：分页拉取会话消息
 * 约束：limit 默认 50，最大 200；beforeSeq 可选（不传表示从最新往回取）
 * 返回：Promise<{ threadId, headSeq, items }>
 */
export async function getChatThreadMessagesInteractor({ chatThreadRepo, threadId, beforeSeq, limit }) {
  if (!chatThreadRepo?.getThreadMessagesPage) throw new Error("chatThreadRepo.getThreadMessagesPage 缺失。");
  const id = normalizeText(threadId);
  return await chatThreadRepo.getThreadMessagesPage({ threadId: id, beforeSeq, limit });
}

/**
 * 中文注释：
 * clearChatThreadInteractor({ chatThreadRepo, threadId })
 * 作用：清空会话消息
 * 约束：会重置 headSeq=0
 * 返回：Promise<{ threadId }>
 */
export async function clearChatThreadInteractor({ chatThreadRepo, threadId }) {
  if (!chatThreadRepo?.clearThreadMessages) throw new Error("chatThreadRepo.clearThreadMessages 缺失。");
  const id = normalizeText(threadId);
  await chatThreadRepo.clearThreadMessages({ threadId: id });
  return { threadId: id };
}

