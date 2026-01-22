/**
 * 文件：vcardTurnApiHelpers.js
 * 模块：角色卡设计器
 * 作用：VCard Turn 前端侧通用工具（runLog 构建、错误识别、upstream 组装、final 应用）
 * 依赖：shared/utils/time、vcardDraftApiHelpers
 * @created 2026-01-14
 * @modified 2026-01-20
 */

import { nowTime, streamTurnApiV1Vcard } from "../../../shared";
import { buildReadRequestText } from "../domain/readProtocol";
import { recordApplyResult } from "./vcardDraftApiHelpers";

const RUNLOG_LIMIT = 60;

const RETRYABLE_ERROR_CODES = new Set([
  "MODEL_OUTPUT_INVALID_JSON",
  "MODEL_OUTPUT_KIND_NOT_ALLOWED",
  "MODEL_OUTPUT_MIXED_READ",
  "READ_REQUEST_INVALID",
  "PATCH_PATH_INVALID",
  "PATCH_OP_INVALID",
  "PATCH_ROOT_FORBIDDEN",
  "MODE_FORBIDDEN",
]);

export function normalizeText(value) {
  return String(value ?? "").trim();
}

export function isRetryableVcardError(err) {
  const code = String(err?.code || "").trim();
  return RETRYABLE_ERROR_CODES.has(code);
}

export function buildRetryReason({ err, draft }) {
  const nextTask = String(draft?.meta?.progress?.nextAction?.text || "").trim();
  const lines = [
    `上轮输出不合规：${String(err?.message || err || "").trim()}`.trim(),
    "请纠偏：若需要修改草稿，确保输出一个可解析的 <tool_use> 工具调用（只允许 1 个 tool_use 块），且块外不要输出多余文本；若本轮只是提问/说明，请直接输出纯文本（不要输出 <tool_use>）。",
    nextTask ? `当前任务：${nextTask}` : "",
  ];
  return lines.filter(Boolean).join("\n").slice(0, 800);
}

export function buildUpstream({ api, provider }) {
  const p = String(provider || "");
  const conn = api?.providers?.[p] || { baseUrl: "", key: "", region: "", projectId: "" };
  return {
    provider: p,
    baseUrl: String(conn.baseUrl || ""),
    apiKey: String(conn.key || ""),
    region: p === "vertexai" ? String(conn.region || "") : "",
    projectId: p === "vertexai" ? String(conn.projectId || "") : "",
  };
}

export function pushRunLog(runLogRef, item) {
  const next = Array.isArray(runLogRef.value) ? runLogRef.value.slice() : [];
  next.push({ ...item });
  runLogRef.value = next.slice(-RUNLOG_LIMIT);
}

export function buildOkRunLogItem({ mode, beforeDraft, afterDraft, kinds, changedPaths, assistantChars, artifactChanged }) {
  return {
    ok: true,
    at: nowTime(),
    mode: String(mode || "turn"),
    // 前端仅保留 Auto：不展示/记录额外的“阶段覆盖”语义（避免 UI 误导）
    planWorkMode: "",
    stepBefore: beforeDraft?.meta?.progress?.stepIndex ?? "—",
    stepAfter: afterDraft?.meta?.progress?.stepIndex ?? "—",
    stepNameBefore: String(beforeDraft?.meta?.progress?.stepName || ""),
    stepNameAfter: String(afterDraft?.meta?.progress?.stepName || ""),
    artifactChanged: Boolean(artifactChanged),
    changedPaths: Array.isArray(changedPaths) ? changedPaths : [],
    kinds: Array.isArray(kinds) ? kinds : [],
    assistantChars: Number(assistantChars || 0),
    note: "",
    error: "",
  };
}

export function buildFailRunLogItem({ mode, error }) {
  return {
    ok: false,
    at: nowTime(),
    mode: String(mode || "turn"),
    error: String(error || "请求失败"),
    kinds: [],
    changedPaths: [],
    artifactChanged: false,
  };
}

export async function applyTurnFinal({ draftApi, runLogRef, beforeDraft, out, extras, mode }) {
  const baseVersion = Number(out?.baseVersion) || 0;
  const nextVersion = Number(out?.version) || Number(draftApi.draftVersion.value) || 0;
  // 未产生新版本时（纯文本/无 patch）：不写入 undo，避免产生“空撤销”。
  if (baseVersion >= 1 && nextVersion > baseVersion) draftApi.pushUndoToVersion(baseVersion);
  draftApi.draftVersion.value = nextVersion;
  draftApi.draft.value = out?.snapshot || null;
  draftApi.updateBoardMessage(out?.snapshot || null);
  await draftApi.refreshChatFromServer({ id: String(out?.draftId || draftApi.draftId.value || ""), extraMessages: extras });

  recordApplyResult({
    lastApplyRef: draftApi.lastApply,
    beforeDraft,
    afterDraft: out?.snapshot || null,
    kinds: Array.isArray(out?.runLog?.kinds) ? out.runLog.kinds : [],
    changedPaths: Array.isArray(out?.changedPaths) ? out.changedPaths : [],
  });

  const artifactChanged = draftApi.computeArtifactChanged(out?.changedPaths);
  const logItem = buildOkRunLogItem({
    mode,
    beforeDraft,
    afterDraft: out?.snapshot || null,
    kinds: Array.isArray(out?.runLog?.kinds) ? out.runLog.kinds : [],
    changedPaths: out?.changedPaths || [],
    assistantChars: out?.runLog?.assistantChars || 0,
    artifactChanged,
  });
  pushRunLog(runLogRef, logItem);
}

/**
 * 中文注释：
 * runStreamTurnOnce(deps)
 * 作用：以 SSE 方式执行单次 turn，并将 delta/read 消息映射到 chat
 * 约束：遇到 error/final 立即返回/抛错；未收到 final 视为异常
 * 参数：
 *  - deps: { base, upstream, input, model, chatRef, readFocusPathsRef, beforeDraft, pushTurnEvent, pickFinalEventPayload, pickErrorEventPayload }
 *  - signal?: AbortSignal
 * 返回：Promise<{ type:'final'|'paused', out:any, extras:any[], baseLen:number, beforeDraft:any }>
 */
export async function runStreamTurnOnce({
  base,
  upstream,
  input,
  model,
  chatRef,
  readFocusPathsRef,
  beforeDraft,
  pushTurnEvent,
  pickFinalEventPayload,
  pickErrorEventPayload,
  signal,
}) {
  const extras = [];
  const baseLen = Array.isArray(chatRef.value) ? chatRef.value.length : 0;
  const req = { ...input, baseVersion: base, upstream, model: normalizeText(model) || "" };

  let streamAssistantIdx = null;
  const ensureStreamAssistant = () => {
    if (Number.isFinite(streamAssistantIdx) && streamAssistantIdx >= 0) return streamAssistantIdx;
    const msg = { role: "assistant", content: "", time: nowTime() };
    chatRef.value.push(msg);
    streamAssistantIdx = chatRef.value.length - 1;
    return streamAssistantIdx;
  };
  const removeStreamAssistantIfAny = () => {
    const i = Number(streamAssistantIdx);
    if (!Number.isFinite(i) || i < 0) return;
    if (!Array.isArray(chatRef.value) || i >= chatRef.value.length) return;
    chatRef.value.splice(i, 1);
    streamAssistantIdx = null;
  };

  try {
    for await (const evt of streamTurnApiV1Vcard(req, { signal })) {
      if (evt.event === "meta") pushTurnEvent("meta", evt.data, evt.id);

      if (evt.event === "delta") {
        const delta = String(evt.data?.text || "");
        if (!delta) continue;
        const idx = ensureStreamAssistant();
        const m = chatRef.value?.[idx];
        if (m) m.content = `${m.content || ""}${delta}`;
      }

      if (evt.event === "read_request") {
        // read-loop：避免把 read 请求 JSON 以 delta 形式暴露到对话（UI 会显示 read_request/read_result）
        removeStreamAssistantIfAny();
        const reads = Array.isArray(evt.data?.reads) ? evt.data.reads : [];
        readFocusPathsRef.value = reads.map((r) => String(r?.path || "").trim().replace(/\\/g, "/")).filter((p) => p && p.includes("/"));
        const msg = { role: "assistant", content: buildReadRequestText(reads), time: nowTime() };
        extras.push(msg);
        chatRef.value.push(msg);
      }

      if (evt.event === "read_result") {
        const msg = { role: "assistant", content: String(evt.data?.text || ""), time: nowTime() };
        extras.push(msg);
        chatRef.value.push(msg);
      }

      if (evt.event === "patch_ops") pushTurnEvent("patch_ops", evt.data, evt.id);
      if (evt.event === "applied") pushTurnEvent("applied", evt.data, evt.id);

      if (evt.event === "final") {
        const out = evt.data;
        pushTurnEvent("final", pickFinalEventPayload(out), evt.id);
        if (out?.paused) return { type: "paused", out, extras, baseLen, beforeDraft };
        return { type: "final", out, extras, baseLen, beforeDraft };
      }
    }
  } catch (err) {
    const aborted = Boolean(signal?.aborted) || String(err?.name || "").trim() === "AbortError";
    if (aborted) {
      // Stop：保留已产生的 user/assistant/read 内容；若仅创建了空的 assistant 占位则清理掉。
      const idx = Number(streamAssistantIdx);
      if (Number.isFinite(idx) && idx >= 0 && Array.isArray(chatRef.value) && idx < chatRef.value.length) {
        const m = chatRef.value[idx];
        if (m?.role === "assistant" && !String(m?.content || "").trim()) chatRef.value.splice(idx, 1);
      }
      throw err;
    }
    pushTurnEvent("error", pickErrorEventPayload(err), err?.eventId);
    if (Array.isArray(chatRef.value)) chatRef.value.splice(baseLen);
    throw err;
  }

  if (Array.isArray(chatRef.value)) chatRef.value.splice(baseLen);
  throw new Error("流式连接已结束但未收到 final 事件。");
}
