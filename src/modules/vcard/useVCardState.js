/**
 * 文件：useVCardState.js
 * 模块：角色卡设计器
 * 作用：聚合 VCard 工作台所需的 state + actions（以服务端 Draft/VCard Turn 为真源）
 * 依赖：Vue、useVCardDraftApi、useVCardTurnApi
 * @created 2025-12-29
 * @modified 2026-01-21
 */

import { computed, onMounted, ref, watch } from "vue";
import {
  acceptApiV1VcardPendingPatch,
  approveApiV1VcardPendingPlan,
  createRequestId,
  getApiV1Settings,
  getApiV1VcardPending,
  nowTime,
  rejectApiV1VcardPendingPatch,
  rejectApiV1VcardPendingPlan,
} from "../../shared";
import { useVCardDraftApi } from "./composables/useVCardDraftApi";
import { useVCardTurnApi } from "./composables/useVCardTurnApi";
import { recordApplyResult } from "./composables/vcardDraftApiHelpers";
import { advanceVibePlan, normalizeVibePlan, pickVibePlanCurrent } from "./domain/vibePlan";

const EVENTLOG_LIMIT = 200;

// 中文注释：
// useVCardState(deps)
// 作用：提供“角色卡设计器”页面所需的状态与操作（草稿/聊天/发送/应用输出）
// 约束：Draft/Chat/Turn 以服务端为真源；apiKey 仍由前端保存并随请求发送
// 参数：
//  - deps: { activePreset, activeProvider, activeModel, api, ctx, ui }
// 返回：state + actions（供 VCardPage 消费）
export function useVCardState({ activeProvider, activeModel, api, ctx, ui }) {
  const readFocusPaths = ref([]);
  const eventLog = ref([]);
  let eventSeq = 0;
  const lastInputSnapshot = ref("");

  function summarizeEvent({ type, data }) {
    const t = String(type || "").trim();
    if (t === "meta") {
      const mode = String(data?.mode || "");
      const provider = String(data?.provider || "");
      const base = data?.baseVersion ?? "";
      return [mode ? `mode=${mode}` : "", provider ? `provider=${provider}` : "", base !== "" ? `base=${base}` : ""].filter(Boolean).join(" ");
    }
    if (t === "patch_ops") {
      const kinds = Array.isArray(data?.kinds) ? data.kinds : [];
      const ops = Array.isArray(data?.patchOps) ? data.patchOps : [];
      const k = kinds.length ? `kinds=${kinds.join("/")}` : "kinds=—";
      const o = `ops=${ops.length}`;
      return `${k} ${o}`.trim();
    }
    if (t === "applied") {
      const version = data?.version ?? "";
      const changed = Array.isArray(data?.changedPaths) ? data.changedPaths.length : 0;
      return `version=${version} changed=${changed}`.trim();
    }
    if (t === "error") {
      const code = String(data?.code || "");
      const msg = String(data?.message || data?.error || "").trim();
      const brief = msg.length > 60 ? `${msg.slice(0, 60)}…` : msg;
      return code ? `${code}: ${brief}`.trim() : brief;
    }
    if (t === "final") {
      const version = data?.version ?? "";
      const paused = Boolean(data?.paused);
      const stop = String(data?.stopReason || "").trim();
      const turns = data?.turns ?? "";
      if (stop) return `stop=${stop} turns=${turns} version=${version}`.trim();
      return paused ? `paused version=${version}`.trim() : `version=${version}`.trim();
    }
    return "";
  }

  function pushEvent({ scope, type, data, sseId }) {
    const item = {
      id: (eventSeq += 1),
      at: nowTime(),
      scope: String(scope || ""),
      type: String(type || ""),
      sseId: sseId === null || sseId === undefined ? "" : String(sseId),
      summary: summarizeEvent({ type, data }),
      data: data ?? null,
    };
    const next = Array.isArray(eventLog.value) ? eventLog.value.slice() : [];
    next.push(item);
    eventLog.value = next.slice(-EVENTLOG_LIMIT);
  }

  function clearEventLog() {
    eventLog.value = [];
  }

  const draftApi = useVCardDraftApi();

  const pending = ref(null);
  const pendingBusy = ref(false);
  const pendingKind = computed(() => String(pending.value?.kind || "").trim());
  const hasPending = computed(() => pendingKind.value === "plan_review" || pendingKind.value === "patch_review");

  async function refreshPending() {
    const id = String(draftApi.draftId.value || "").trim();
    if (!id) {
      pending.value = null;
      return;
    }

    pendingBusy.value = true;
    try {
      const out = await getApiV1VcardPending(id);
      pending.value = out?.pending || null;
      pushEvent({ scope: "pending", type: "refreshed", data: out?.pending || null, sseId: "" });
    } catch (err) {
      pending.value = null;
      pushEvent({ scope: "pending", type: "error", data: { message: String(err?.message || err || "pending 查询失败") }, sseId: "" });
    } finally {
      pendingBusy.value = false;
    }
  }

  const turnApi = useVCardTurnApi({
    draftApi,
    activeProvider,
    activeModel,
    api,
    ctx,
    ui,
    chat: draftApi.chat,
    readFocusPaths,
    pushEvent,
    onReviewPaused: refreshPending,
  });

  async function replanKeepArtifacts() {
    await draftApi.applyVibePlan({
      patchOp: { op: "set", path: "raw.dataExtensions.vibePlan", value: null },
      kinds: ["vibePlan.reset"],
    });
  }

  async function manualAdvanceCurrentTask() {
    draftApi.boardError.value = "";
    draftApi.lastApply.value = null;

    const rawPlan = draftApi.draft.value?.raw?.dataExtensions?.vibePlan;
    if (!rawPlan || typeof rawPlan !== "object") return (draftApi.boardError.value = "当前无 vibePlan：请先生成任务清单。");

    const plan = normalizeVibePlan(rawPlan);
    const current = pickVibePlanCurrent(plan);
    if (current.type !== "ok" && current.type !== "blocked") return (draftApi.boardError.value = "当前任务不可推进：请先修复 vibePlan。");

    const taskId = String(current.taskId || "");
    if (!taskId) return (draftApi.boardError.value = "当前任务不可推进：taskId 为空。");
    if (!confirm(`确定将当前任务标记完成并推进吗？\n\n- taskId: ${taskId}`)) return;

    await draftApi.applyVibePlan({
      patchOp: { op: "set", path: "raw.dataExtensions.vibePlan", value: advanceVibePlan(plan, taskId) },
      kinds: ["vibePlan.advance"],
    });
  }

  async function importCharaCardJson(cardJson) {
    await draftApi.importCharaCardJson(cardJson);
  }

  function exportCharaCardJson() {
    return draftApi.exportCharaCardJson();
  }

  function resolveChatViewFromSettings(settings) {
    const oc = settings?.vcard?.outputCleaner && typeof settings.vcard.outputCleaner === "object" ? settings.vcard.outputCleaner : {};
    const cfg = oc?.config && typeof oc.config === "object" ? oc.config : null;
    if (!cfg || !cfg.enabled) return "raw";
    if (!Array.isArray(cfg.rules) || cfg.rules.length === 0) return "raw";
    return oc.writeBack === false ? "cleaned" : "raw";
  }

  async function syncChatViewFromSettings({ refreshChat } = {}) {
    try {
      const settings = await getApiV1Settings();
      draftApi.setChatView(resolveChatViewFromSettings(settings));
      if (refreshChat) {
        const id = String(draftApi.draftId.value || "").trim();
        if (id) await draftApi.refreshChatFromServer({ id, extraMessages: [] });
      }
    } catch {
      // ignore settings load failure
    }
  }

  onMounted(async () => {
    await syncChatViewFromSettings();
    await draftApi.refreshFromBoard();
    await refreshPending();
  });

  watch(
    () => String(draftApi.draftId.value || ""),
    (next, prev) => {
      if (String(next || "") === String(prev || "")) return;
      refreshPending().catch(() => undefined);
    },
  );

  watch(
    () => Number(draftApi.draftVersion.value) || 0,
    (next, prev) => {
      if (!hasPending.value) return;
      if (Number(next) === Number(prev)) return;
      refreshPending().catch(() => undefined);
    },
  );

  function buildPendingBlockError(kind) {
    const k = String(kind || "").trim();
    if (k === "plan_review") return "草稿存在待审批计划：请先在右侧进行 批准/驳回/追问。";
    if (k === "patch_review") return "草稿存在待确认变更：请先在右侧进行 Accept/Reject/追问。";
    return "草稿存在待审批项：请先处理后再继续。";
  }

  async function applyAppliedDraftResult({ applied, beforeDraft, kinds }) {
    const out = applied && typeof applied === "object" ? applied : {};
    const id = String(out.draftId || draftApi.draftId.value || "").trim();
    if (!id) return;

    draftApi.pushUndoToVersion(out.baseVersion);
    draftApi.draftVersion.value = Number(out.version) || Number(draftApi.draftVersion.value) || 0;
    draftApi.draft.value = out.snapshot || null;
    draftApi.updateBoardMessage(out.snapshot || null);
    await draftApi.refreshChatFromServer({ id, extraMessages: [] });

    recordApplyResult({
      lastApplyRef: draftApi.lastApply,
      beforeDraft,
      afterDraft: out.snapshot || null,
      kinds: Array.isArray(kinds) ? kinds : [],
      changedPaths: Array.isArray(out.changedPaths) ? out.changedPaths : [],
    });
  }

  async function approvePendingPlan() {
    draftApi.boardError.value = "";
    draftApi.lastApply.value = null;
    const p = pending.value;
    if (!p || String(p.kind) !== "plan_review") return;
    if (pendingBusy.value || turnApi.sending.value) return;

    pendingBusy.value = true;
    const beforeDraft = draftApi.draft.value;
    try {
      const out = await approveApiV1VcardPendingPlan({
        draftId: p.draftId,
        baseVersion: p.baseVersion,
        fpBefore: p.fpBefore,
        requestId: createRequestId(),
      });
      pending.value = null;
      await applyAppliedDraftResult({ applied: out, beforeDraft, kinds: ["vibePlan.approve"] });
      // 批准计划后自动继续：让模型按新的 progress.nextAction 开始执行首个任务。
      await turnApi.runWithoutUserInput();
    } catch (err) {
      draftApi.boardError.value = `批准失败：${String(err?.message || err)}`;
      await refreshPending();
    } finally {
      pendingBusy.value = false;
    }
  }

  async function rejectPendingPlan() {
    draftApi.boardError.value = "";
    const p = pending.value;
    if (!p || String(p.kind) !== "plan_review") return;
    if (pendingBusy.value || turnApi.sending.value) return;

    pendingBusy.value = true;
    try {
      await rejectApiV1VcardPendingPlan({ draftId: p.draftId, baseVersion: p.baseVersion, fpBefore: p.fpBefore });
      pending.value = null;
    } catch (err) {
      draftApi.boardError.value = `驳回失败：${String(err?.message || err)}`;
      await refreshPending();
    } finally {
      pendingBusy.value = false;
    }
  }

  async function acceptPendingPatch() {
    draftApi.boardError.value = "";
    draftApi.lastApply.value = null;
    const p = pending.value;
    if (!p || String(p.kind) !== "patch_review") return;
    if (pendingBusy.value || turnApi.sending.value) return;

    pendingBusy.value = true;
    const beforeDraft = draftApi.draft.value;
    try {
      const out = await acceptApiV1VcardPendingPatch({
        draftId: p.draftId,
        baseVersion: p.baseVersion,
        fpBefore: p.fpBefore,
        requestId: createRequestId(),
      });
      const kinds = Array.isArray(p?.pendingReview?.kinds) ? p.pendingReview.kinds : ["patch.accept"];
      pending.value = null;
      await applyAppliedDraftResult({ applied: out, beforeDraft, kinds });
      // Accept 变更后自动继续：推进到下一步/下一任务（若需要再次确认则会再次进入 pending）。
      await turnApi.runWithoutUserInput();
    } catch (err) {
      draftApi.boardError.value = `Accept 失败：${String(err?.message || err)}`;
      await refreshPending();
    } finally {
      pendingBusy.value = false;
    }
  }

  async function rejectPendingPatch() {
    draftApi.boardError.value = "";
    const p = pending.value;
    if (!p || String(p.kind) !== "patch_review") return;
    if (pendingBusy.value || turnApi.sending.value) return;

    pendingBusy.value = true;
    try {
      await rejectApiV1VcardPendingPatch({ draftId: p.draftId, baseVersion: p.baseVersion, fpBefore: p.fpBefore });
      pending.value = null;
    } catch (err) {
      draftApi.boardError.value = `Reject 失败：${String(err?.message || err)}`;
      await refreshPending();
    } finally {
      pendingBusy.value = false;
    }
  }

  async function askPending({ askText }) {
    draftApi.boardError.value = "";
    const p = pending.value;
    const text = String(askText || "").trim();
    if (!p || !text) return;
    if (pendingBusy.value || turnApi.sending.value) return;

    pendingBusy.value = true;
    try {
      if (String(p.kind) === "plan_review") await rejectApiV1VcardPendingPlan({ draftId: p.draftId, baseVersion: p.baseVersion, fpBefore: p.fpBefore });
      else if (String(p.kind) === "patch_review") await rejectApiV1VcardPendingPatch({ draftId: p.draftId, baseVersion: p.baseVersion, fpBefore: p.fpBefore });
      pending.value = null;
    } catch (err) {
      draftApi.boardError.value = `追问失败（清理 pending 失败）：${String(err?.message || err)}`;
      await refreshPending();
      pendingBusy.value = false;
      return;
    } finally {
      pendingBusy.value = false;
    }

    await turnApi.runWithUserText({ userText: text });
  }

  async function sendMessage() {
    if (hasPending.value) return (draftApi.boardError.value = buildPendingBlockError(pendingKind.value));
    const raw = String(turnApi.userInput.value || "");
    if (raw.trim()) {
      lastInputSnapshot.value = raw;
    }
    await turnApi.sendMessage();
  }

  const canRestoreInput = computed(() => Boolean(String(lastInputSnapshot.value || "").trim()) && !String(turnApi.userInput.value || "").trim());
  const canRetryLastAction = computed(() => {
    return Boolean(turnApi.lastTurnAction.value && turnApi.lastTurnError.value) && !turnApi.sending.value;
  });

  const restoreInputTitle = computed(() => "恢复到上一次发送前的输入");
  const retryLastActionTitle = computed(() => {
    const hint = "重试上一次（复用 requestId 做幂等，尽量避免重复消息）";
    const msg = String(turnApi.lastTurnError.value?.message || "").trim();
    return msg ? `${hint}\n最后错误：${msg}` : hint;
  });

  function restoreInput() {
    const snap = String(lastInputSnapshot.value || "");
    if (!snap.trim()) return;
    if (String(turnApi.userInput.value || "").trim()) {
      if (!confirm("当前输入框已有内容，仍要恢复上一次输入吗？")) return;
    }
    turnApi.userInput.value = snap;
  }

  async function retryLastAction() {
    if (!canRetryLastAction.value) return;
    return await turnApi.retryLastTurn();
  }

  return {
    ctx,
    chat: draftApi.chat,
    draft: draftApi.draft,
    boardError: draftApi.boardError,
    lastApply: draftApi.lastApply,
    exportMode: draftApi.exportMode,
    pending,
    pendingBusy,

    userInput: turnApi.userInput,
    sending: turnApi.sending,
    stopping: turnApi.stopping,
    runLog: turnApi.runLog,
    readFocusPaths,
    eventLog,

    canRestoreInput,
    restoreInputTitle,
    restoreInput,
    canRetryLastAction,
    retryLastActionTitle,
    retryLastAction,

    canUndo: draftApi.canUndo,
    canRedo: draftApi.canRedo,

    initBoard: draftApi.initBoard,
    setExportMode: draftApi.setExportMode,
    clearChat: draftApi.clearChat,
    clearRunLog: () => (turnApi.runLog.value = []),
    clearEventLog,
    refreshFromBoard: draftApi.refreshFromBoard,
    writeBoard: draftApi.writeBoard,
    refreshPending,
    approvePendingPlan,
    rejectPendingPlan,
    acceptPendingPatch,
    rejectPendingPatch,
    askPending,
    importCharaCardJson,
    exportCharaCardJson,
    replanKeepArtifacts,
    manualAdvanceCurrentTask,
    applyItems: draftApi.applyItems,
    syncChatViewFromSettings,
    undo: draftApi.undo,
    redo: draftApi.redo,
    cancelSend: turnApi.cancelSend,
    sendMessage,
  };
}
