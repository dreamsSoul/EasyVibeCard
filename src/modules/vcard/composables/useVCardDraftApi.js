/**
 * 文件：useVCardDraftApi.js
 * 模块：角色卡设计器
 * 作用：以服务端为真源管理 Draft/Chat（draftId/version/snapshot、apply-items、undo/redo、导入导出）
 * 依赖：Vue、shared/apiV1、vcard/domain
 * @created 2026-01-11
 * @modified 2026-01-20
 */

import { computed, ref } from "vue";
import {
  nowTime,
  readStorageJson,
  writeStorageJson,
  createApiV1Draft,
  getApiV1Draft,
  getApiV1DraftChat,
  applyApiV1DraftItems,
  applyApiV1DraftPatch,
  rollbackApiV1Draft,
} from "../../../shared";
import { buildDraftBoardMarkdown } from "../domain/draftBoard";
import { cardDraftToCharaCardV3, charaCardToCardDraft } from "../domain/charaCardV3";
import { buildApplyItemsFromDraft, isArtifactPath, normalizeText, recordApplyResult, toTimeLabel } from "./vcardDraftApiHelpers";

const HISTORY_LIMIT = 60;
const STORAGE_KEYS = Object.freeze({
  DRAFT_ID: "stlike_vcard_draft_id_v1",
});
// 中文注释：
// useVCardDraftApi()
// 作用：提供 Draft/Chat 真源状态与变更动作（含 undo/redo 的 rollback 实现）
// 约束：本地只持久化 draftId；每次应用变更后以服务端 snapshot 为准刷新
// 参数：无
// 返回：state + actions
export function useVCardDraftApi() {
  const draftId = ref(String(readStorageJson(STORAGE_KEYS.DRAFT_ID, "") || ""));
  const draftVersion = ref(0);
  const draft = ref(null);
  const chat = ref([]);
  const chatView = ref("raw");
  const boardError = ref("");
  const lastApply = ref(null);
  const exportMode = ref("publish");
  const undoStack = ref([]);
  const redoStack = ref([]);
  const canUndo = computed(() => (Array.isArray(undoStack.value) ? undoStack.value.length : 0) > 0);
  const canRedo = computed(() => (Array.isArray(redoStack.value) ? redoStack.value.length : 0) > 0);
  function setExportMode(mode) {
    exportMode.value = String(mode) === "work" ? "work" : "publish";
  }
  function setDraftId(nextId) {
    draftId.value = String(nextId || "");
    writeStorageJson(STORAGE_KEYS.DRAFT_ID, draftId.value);
  }
  function pushUndoToVersion(toVersion) {
    const toV = Number(toVersion) || 0;
    if (toV < 1) return;
    const next = [...(Array.isArray(undoStack.value) ? undoStack.value : []), { toVersion: toV, at: nowTime() }].slice(-HISTORY_LIMIT);
    undoStack.value = next;
    redoStack.value = [];
  }

  function updateBoardMessage(snapshot) {
    const msg = { role: "assistant", content: buildDraftBoardMarkdown(snapshot || {}), time: toTimeLabel(snapshot?.meta?.updatedAt) };
    if (!Array.isArray(chat.value) || chat.value.length === 0) chat.value = [msg];
    else chat.value.splice(0, 1, msg);
  }

  function setChatView(view) {
    chatView.value = String(view || "") === "cleaned" ? "cleaned" : "raw";
  }

  async function refreshChatFromServer({ id, extraMessages }) {
    const page = await getApiV1DraftChat(id, { limit: 200, view: chatView.value });
    const items = Array.isArray(page?.items) ? page.items : [];
    const messages = items.map((m) => ({ role: m.role, content: String(m.content || ""), time: toTimeLabel(m.createdAt) }));
    const extras = Array.isArray(extraMessages) ? extraMessages : [];
    chat.value = [chat.value?.[0] || { role: "assistant", content: "", time: nowTime() }, ...messages, ...extras];
  }

  async function ensureDraftOrCreate() {
    const id = normalizeText(draftId.value);
    if (id) {
      try {
        const out = await getApiV1Draft(id);
        if (out?.snapshot) return { draftId: id, version: Number(out?.version) || 0, snapshot: out.snapshot };
      } catch {}
    }
    const created = await createApiV1Draft({});
    const nextId = String(created?.draftId || "");
    setDraftId(nextId);
    return { draftId: nextId, version: Number(created?.version) || 0, snapshot: created?.snapshot || null };
  }

  async function refreshFromBoard(extraMessages) {
    boardError.value = "";
    lastApply.value = null;
    try {
      const current = await ensureDraftOrCreate();
      draftVersion.value = Number(current.version) || 0;
      draft.value = current.snapshot;
      updateBoardMessage(current.snapshot);
      await refreshChatFromServer({ id: current.draftId, extraMessages });
    } catch (err) {
      boardError.value = `刷新失败：${String(err?.message || err)}`;
    }
  }

  async function initBoard({ force } = {}) {
    boardError.value = "";
    lastApply.value = null;
    const hasChat = (Array.isArray(chat.value) ? chat.value.length : 0) > 1;
    if (!force && hasChat && !confirm("检测到已有对话记录，重建将创建新草稿并清空对话。确定继续吗？")) return;
    try {
      const created = await createApiV1Draft({});
      setDraftId(created?.draftId || "");
      draftVersion.value = Number(created?.version) || 0;
      draft.value = created?.snapshot || null;
      updateBoardMessage(created?.snapshot || null);
      undoStack.value = [];
      redoStack.value = [];
      await refreshChatFromServer({ id: draftId.value, extraMessages: [] });
    } catch (err) { boardError.value = `重建失败：${String(err?.message || err)}`; }
  }

  async function applyItems(items) {
    boardError.value = "";
    lastApply.value = null;
    const id = normalizeText(draftId.value);
    const base = Number(draftVersion.value) || 0;
    const list = Array.isArray(items) ? items : [];
    if (!id || base < 1) return (boardError.value = "草稿未就绪：请先初始化看板。");
    if (list.length === 0) return;

    const beforeDraft = draft.value;
    try {
      const out = await applyApiV1DraftItems(id, { baseVersion: base, mode: "auto", items: list });
      pushUndoToVersion(base);
      draftVersion.value = Number(out?.version) || base;
      draft.value = out?.snapshot || null;
      updateBoardMessage(out?.snapshot || null);
      await refreshChatFromServer({ id, extraMessages: [] });
      recordApplyResult({ lastApplyRef: lastApply, beforeDraft, afterDraft: out?.snapshot || null, kinds: list.map((x) => String(x?.kind || "")).filter(Boolean), changedPaths: out?.changedPaths || [] });
    } catch (err) {
      boardError.value = `应用失败：${String(err?.message || err)}`;
    }
  }

  async function applyVibePlan({ patchOp, kinds }) {
    boardError.value = "";
    lastApply.value = null;
    const id = normalizeText(draftId.value);
    const base = Number(draftVersion.value) || 0;
    if (!id || base < 1) return (boardError.value = "草稿未就绪：请先初始化看板。");

    const beforeDraft = draft.value;
    try {
      const out = await applyApiV1DraftPatch(id, { baseVersion: base, mode: "auto", patchOps: [patchOp] });
      pushUndoToVersion(base);
      draftVersion.value = Number(out?.version) || base;
      draft.value = out?.snapshot || null;
      updateBoardMessage(out?.snapshot || null);
      await refreshChatFromServer({ id, extraMessages: [] });
      recordApplyResult({ lastApplyRef: lastApply, beforeDraft, afterDraft: out?.snapshot || null, kinds, changedPaths: out?.changedPaths || [] });
    } catch (err) {
      boardError.value = `应用失败：${String(err?.message || err)}`;
    }
  }

  async function undo() {
    boardError.value = "";
    lastApply.value = null;
    const id = normalizeText(draftId.value);
    const base = Number(draftVersion.value) || 0;
    const stack = Array.isArray(undoStack.value) ? undoStack.value.slice() : [];
    const last = stack.pop();
    if (!id || base < 1 || !last) return;

    try {
      const out = await rollbackApiV1Draft(id, { baseVersion: base, toVersion: last.toVersion });
      redoStack.value = [...(Array.isArray(redoStack.value) ? redoStack.value : []), { toVersion: base, at: nowTime() }].slice(-HISTORY_LIMIT);
      undoStack.value = stack;
      draftVersion.value = Number(out?.version) || base;
      draft.value = out?.snapshot || null;
      updateBoardMessage(out?.snapshot || null);
      await refreshChatFromServer({ id, extraMessages: [] });
    } catch (err) {
      boardError.value = `撤销失败：${String(err?.message || err)}`;
    }
  }

  async function redo() {
    boardError.value = "";
    lastApply.value = null;
    const id = normalizeText(draftId.value);
    const base = Number(draftVersion.value) || 0;
    const stack = Array.isArray(redoStack.value) ? redoStack.value.slice() : [];
    const last = stack.pop();
    if (!id || base < 1 || !last) return;

    try {
      const out = await rollbackApiV1Draft(id, { baseVersion: base, toVersion: last.toVersion });
      undoStack.value = [...(Array.isArray(undoStack.value) ? undoStack.value : []), { toVersion: base, at: nowTime() }].slice(-HISTORY_LIMIT);
      redoStack.value = stack;
      draftVersion.value = Number(out?.version) || base;
      draft.value = out?.snapshot || null;
      updateBoardMessage(out?.snapshot || null);
      await refreshChatFromServer({ id, extraMessages: [] });
    } catch (err) {
      boardError.value = `重做失败：${String(err?.message || err)}`;
    }
  }

  async function clearChat() {
    boardError.value = "";
    lastApply.value = null;
    if (!draft.value) return await initBoard({ force: true });
    try {
      const created = await createApiV1Draft({});
      const nextId = String(created?.draftId || "");
      const base = Number(created?.version) || 0;
      if (!nextId || base < 1) return;
      const items = buildApplyItemsFromDraft(draft.value);
      const applied = await applyApiV1DraftItems(nextId, { baseVersion: base, mode: "auto", items });
      setDraftId(nextId);
      undoStack.value = [];
      redoStack.value = [];
      draftVersion.value = Number(applied?.version) || base;
      draft.value = applied?.snapshot || null;
      updateBoardMessage(applied?.snapshot || null);
      await refreshChatFromServer({ id: nextId, extraMessages: [] });
    } catch (err) { boardError.value = `清空失败：${String(err?.message || err)}`; }
  }

  async function importCharaCardJson(cardJson) {
    const nextDraft = charaCardToCardDraft(cardJson);
    const created = await createApiV1Draft({});
    const nextId = String(created?.draftId || "");
    const base = Number(created?.version) || 0;
    if (!nextId || base < 1) throw new Error("创建草稿失败。");

    const items = buildApplyItemsFromDraft(nextDraft);
    const applied = await applyApiV1DraftItems(nextId, { baseVersion: base, mode: "auto", items });

    const vibePlan = nextDraft?.raw?.dataExtensions?.vibePlan;
    const shouldSetVibePlan = vibePlan && typeof vibePlan === "object";
    if (shouldSetVibePlan) {
      const v2 = Number(applied?.version) || base;
      const out2 = await applyApiV1DraftPatch(nextId, { baseVersion: v2, mode: "auto", patchOps: [{ op: "set", path: "raw.dataExtensions.vibePlan", value: vibePlan }] });
      applied.version = out2?.version || applied.version;
      applied.snapshot = out2?.snapshot || applied.snapshot;
    }

    setDraftId(nextId);
    undoStack.value = [];
    redoStack.value = [];
    draftVersion.value = Number(applied?.version) || base;
    draft.value = applied?.snapshot || null;
    updateBoardMessage(applied?.snapshot || null);
    await refreshChatFromServer({ id: nextId, extraMessages: [] });
  }

  function exportCharaCardJson() {
    if (!draft.value) throw new Error("草稿未就绪：请先初始化看板。");
    return cardDraftToCharaCardV3(draft.value, { mode: exportMode.value });
  }

  function computeArtifactChanged(changedPaths) {
    const list = Array.isArray(changedPaths) ? changedPaths : [];
    return list.some(isArtifactPath);
  }

  function writeBoard() {
    // 兼容旧按钮：当前后端在 apply/turn 后已刷新 lint/progress；这里做一次 refresh 即可。
    refreshFromBoard();
  }
  return {
    draftId,
    draftVersion,
    draft,
    chat,
    chatView,
    boardError,
    lastApply,
    exportMode,
    canUndo,
    canRedo,
    setDraftId,
    setChatView,
    setExportMode,
    pushUndoToVersion,
    updateBoardMessage,
    refreshChatFromServer,
    refreshFromBoard,
    initBoard,
    clearChat,
    applyItems,
    applyVibePlan,
    undo,
    redo,
    importCharaCardJson,
    exportCharaCardJson,
    computeArtifactChanged,
    writeBoard,
  };
}
