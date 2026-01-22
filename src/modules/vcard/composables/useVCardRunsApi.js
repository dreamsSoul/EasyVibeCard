/**
 * 文件：useVCardRunsApi.js
 * 模块：角色卡设计器
 * 作用：以服务端为真源管理 VCard Run（/api/v1/vcard/runs：start/events/result/cancel）
 * 依赖：Vue、shared/apiV1、vcardDraftApiHelpers
 * @created 2026-01-14
 * @modified 2026-01-14
 */

import { computed, ref } from "vue";
import { cancelApiV1VcardRun, createRequestId, getApiV1VcardRun, nowTime, startApiV1VcardRun, streamApiV1VcardRunEvents } from "../../../shared";
import { recordApplyResult } from "./vcardDraftApiHelpers";

const DEFAULT_RUN_OPTIONS = Object.freeze({
  maxTurns: 20,
  maxReadRounds: 10,
  noChangeTurns: 2,
  planNoProgressTurns: 2,
});

const RECONNECT_DELAY_MS = 800;

function normalizeText(value) {
  return String(value ?? "").trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Number(ms) || 0));
}

function buildUpstream({ api, provider }) {
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

function pickErrorEventPayload(err) {
  return {
    code: err?.code,
    message: String(err?.message || err || "请求失败"),
    requestId: err?.requestId,
    draftId: err?.draftId,
    runId: err?.runId,
    details: err?.details,
  };
}

async function applyRunFinalToDraft({ draftApi, baseVersion, final }) {
  const out = final && typeof final === "object" ? final : {};
  const id = normalizeText(out.draftId || draftApi?.draftId?.value || "");
  if (!id) return;

  const beforeDraft = draftApi.draft.value;
  const snapshot = out.snapshot || null;
  const version = Number(out.version) || Number(draftApi.draftVersion.value) || 0;
  const base = Number(baseVersion) || Number(out.baseVersion) || Number(draftApi.draftVersion.value) || 0;
  // 未产生新版本时（Run 可能因纯文本停止）：不写入 undo，避免产生“空撤销”。
  if (base >= 1 && version > base) draftApi.pushUndoToVersion(base);

  draftApi.draftVersion.value = version;
  draftApi.draft.value = snapshot;
  draftApi.updateBoardMessage(snapshot);
  await draftApi.refreshChatFromServer({ id, extraMessages: [] });

  recordApplyResult({
    lastApplyRef: draftApi.lastApply,
    beforeDraft,
    afterDraft: snapshot,
    kinds: Array.isArray(out?.runLog?.kinds) ? out.runLog.kinds : [],
    changedPaths: Array.isArray(out?.runLog?.changedPaths) ? out.runLog.changedPaths : [],
  });
}

/**
 * 中文注释：
 * useVCardRunsApi(deps)
 * 作用：提供 startRun/cancelRun + SSE 订阅（断线续播），并在 final 时刷新草稿真源
 * 约束：Run 事件落库于服务端；前端仅维护 lastEventId 与 UI 状态；cancel 在“轮次边界”生效
 * 参数：
 *  - deps: { draftApi, activeProvider, activeModel, api, ctx, ui, pushEvent }
 * 返回：{ runId, runStatus, runTurns, stopReason, stopMessage, running, busy, startRun, cancelRun, stopSubscribe }
 */
export function useVCardRunsApi({ draftApi, activeProvider, activeModel, api, ctx, ui, pushEvent }) {
  const runId = ref("");
  const runStatus = ref("");
  const runTurns = ref(0);
  const stopReason = ref("");
  const stopMessage = ref("");
  const baseVersion = ref(0);
  const lastRunStartAction = ref(null);
  const lastRunStartError = ref(null);

  const starting = ref(false);
  const subscribing = ref(false);
  const lastEventId = ref(0);

  const provider = computed(() => String(activeProvider?.value || activeProvider || ""));
  const model = computed(() => String(activeModel?.value || activeModel || ""));
  const running = computed(() => runStatus.value === "running" && Boolean(runId.value));
  const busy = computed(() => Boolean(starting.value));

  let abortController = null;
  let subscribeToken = 0;

  function pushRunEvent(type, data, sseId) {
    if (typeof pushEvent !== "function") return;
    pushEvent({ scope: "run", type, data, sseId });
  }

  function stopSubscribe() {
    subscribeToken += 1;
    if (abortController) abortController.abort();
    abortController = null;
    subscribing.value = false;
  }

  function prepareStartAction({ draftId, mode, userText, reason, runOptions, requestId }) {
    lastRunStartAction.value = { type: "run-start", at: nowTime(), draftId, mode, userText, reason, runOptions, requestId };
    lastRunStartError.value = null;
  }

  function recordStartFailure(err) {
    lastRunStartError.value = { ...pickErrorEventPayload(err), at: nowTime() };
  }

  async function consumeEventsOnce({ rid, token }) {
    abortController = new AbortController();
    try {
      for await (const evt of streamApiV1VcardRunEvents({ runId: rid, lastEventId: lastEventId.value, signal: abortController.signal })) {
        if (token !== subscribeToken) return { type: "canceled" };

        const n = Number(evt.id);
        if (Number.isFinite(n) && n > 0) lastEventId.value = n;

        const type = String(evt.event || "").trim();
        if (type !== "delta" && type !== "ping") pushRunEvent(type, evt.data, evt.id);

        const turnIndex = Number(evt.data?.turnIndex);
        if (Number.isFinite(turnIndex) && turnIndex > 0) runTurns.value = Math.max(runTurns.value, Math.trunc(turnIndex));

        if (type !== "final") continue;
        runStatus.value = "stopped";
        stopReason.value = String(evt.data?.stopReason || "");
        stopMessage.value = String(evt.data?.stopMessage || "");
        runTurns.value = Number(evt.data?.turns) || runTurns.value;
        await applyRunFinalToDraft({ draftApi, baseVersion: baseVersion.value, final: evt.data });
        stopSubscribe();
        return { type: "final" };
      }

      const latest = await getApiV1VcardRun(rid).catch(() => null);
      if (latest?.status !== "stopped") return { type: "continue" };
      runStatus.value = "stopped";
      stopReason.value = String(latest?.stopReason || stopReason.value || "");
      stopMessage.value = String(latest?.stopMessage || stopMessage.value || "");
      stopSubscribe();
      return { type: "stopped" };
    } catch (err) {
      if (token !== subscribeToken) return { type: "canceled" };
      pushRunEvent("error", pickErrorEventPayload(err), err?.eventId);
      runStatus.value = "stopped";
      stopReason.value = String(stopReason.value || "error");
      stopMessage.value = String(stopMessage.value || err?.message || "Run 失败。");
      stopSubscribe();
      return { type: "error" };
    } finally {
      if (abortController) abortController.abort();
      abortController = null;
    }
  }

  async function subscribeEvents({ runId: id }) {
    const rid = normalizeText(id);
    if (!rid) return;
    const token = (subscribeToken += 1);
    subscribing.value = true;
    while (token === subscribeToken) {
      const res = await consumeEventsOnce({ rid, token });
      if (res.type !== "continue") return;
      await sleep(RECONNECT_DELAY_MS);
    }
  }

  async function startRunCore({ mode, userText, reason, runOptions, requestId }) {
    draftApi.boardError.value = "";
    if (busy.value) return;

    const id = normalizeText(draftApi.draftId.value);
    const base = Number(draftApi.draftVersion.value) || 0;
    if (!id || base < 1) return (draftApi.boardError.value = "草稿未就绪：请先初始化看板。");

    const upstream = buildUpstream({ api, provider: provider.value });
    if (String(upstream.provider || "") === "openai" && !normalizeText(upstream.baseUrl)) {
      return (draftApi.boardError.value = "OpenAI Base URL 不能为空。");
    }

    const rid = normalizeText(requestId) || createRequestId();
    prepareStartAction({
      draftId: id,
      mode: normalizeText(mode) || "auto",
      userText: String(userText || ""),
      reason: normalizeText(reason),
      runOptions: runOptions && typeof runOptions === "object" ? { ...runOptions } : null,
      requestId: rid,
    });

    stopReason.value = "";
    stopMessage.value = "";
    runTurns.value = 0;
    lastEventId.value = 0;
    starting.value = true;
    baseVersion.value = base;
    try {
      const input = {
        draftId: id,
        baseVersion: base,
        requestId: rid,
        mode: normalizeText(mode) || "auto",
        reason: normalizeText(reason),
        userText: String(userText || ""),
        presetName: "",
        ctx,
        upstream,
        providerOptions: { upstreamStream: Boolean(ui?.stream) },
        runOptions: { ...DEFAULT_RUN_OPTIONS, ...(runOptions && typeof runOptions === "object" ? runOptions : {}) },
        model: normalizeText(model.value),
      };

      const out = await startApiV1VcardRun(input);
      runId.value = normalizeText(out?.runId || "");
      runStatus.value = String(out?.status || "running");
      baseVersion.value = Number(out?.baseVersion) || base;
      lastRunStartError.value = null;
      stopSubscribe();
      await subscribeEvents({ runId: runId.value });
    } catch (err) {
      draftApi.boardError.value = `Run 启动失败：${String(err?.message || err)}`;
      pushRunEvent("error", pickErrorEventPayload(err), err?.eventId);
      recordStartFailure(err);
    } finally {
      starting.value = false;
    }
  }

  async function startRun({ mode, userText, reason, runOptions }) {
    return await startRunCore({ mode, userText, reason, runOptions, requestId: createRequestId() });
  }

  async function retryLastRunStart() {
    if (busy.value) return;
    const last = lastRunStartAction.value;
    const requestId = normalizeText(last?.requestId);
    if (!requestId) return;
    return await startRunCore({
      mode: last?.mode,
      userText: last?.userText,
      reason: last?.reason,
      runOptions: last?.runOptions,
      requestId,
    });
  }

  async function cancelRun() {
    draftApi.boardError.value = "";
    const id = normalizeText(runId.value);
    if (!id) return;

    try {
      await cancelApiV1VcardRun(id);
    } catch (err) {
      draftApi.boardError.value = `停止失败：${String(err?.message || err)}`;
      pushRunEvent("error", pickErrorEventPayload(err), err?.eventId);
    }
  }

  return {
    runId,
    runStatus,
    runTurns,
    stopReason,
    stopMessage,
    running,
    busy,
    lastRunStartAction,
    lastRunStartError,
    startRun,
    retryLastRunStart,
    cancelRun,
    stopSubscribe,
  };
}
