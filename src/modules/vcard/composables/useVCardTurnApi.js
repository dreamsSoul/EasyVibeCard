/**
 * 文件：useVCardTurnApi.js
 * 模块：角色卡设计器
 * 作用：以服务端为真源执行 VCard Turn（/api/v1/vcard/turn），并把事件映射为 UI 状态
 * 依赖：Vue、shared/apiV1、vcard/domain
 * @created 2026-01-11
 * @modified 2026-01-21
 */
import { computed, ref } from "vue";
import { createRequestId, nowTime, turnApiV1Vcard } from "../../../shared";
import {
  applyTurnFinal,
  buildFailRunLogItem,
  buildRetryReason,
  buildUpstream,
  isRetryableVcardError,
  normalizeText,
  pushRunLog,
  runStreamTurnOnce,
} from "./vcardTurnApiHelpers";
// 中文注释：
// useVCardTurnApi(deps)
// 作用：提供 sendMessage 等跑模型动作（后端 turn + SSE 事件驱动）
// 约束：apiKey 不落库；每次请求必须传 upstream.apiKey；read 事件仅用于 UI 展示
// 参数：
//  - deps: { draftApi, activeProvider, activeModel, api, ctx, ui, chat, readFocusPaths, pushEvent, onReviewPaused?, errorPrefs? }
// 返回：{ userInput, sending, stopping, runLog, lastTurnAction, lastTurnError, runWithoutUserInput, runWithUserText, cancelSend, sendMessage, retryLastTurn }
export function useVCardTurnApi({ draftApi, activeProvider, activeModel, api, ctx, ui, chat, readFocusPaths, pushEvent, onReviewPaused, errorPrefs }) {
  const userInput = ref("");
  const sending = ref(false);
  const runLog = ref([]);
  const lastTurnAction = ref(null);
  const lastTurnError = ref(null);
  const stopping = ref(false);
  const MODE = "auto";

  let sendToken = 0;
  let abortController = null;

  const provider = computed(() => String(activeProvider?.value || activeProvider || ""));
  const model = computed(() => String(activeModel?.value || activeModel || ""));
  const humanizeErrorsEnabled = computed(() => {
    const v = errorPrefs?.humanizeErrors;
    if (v && typeof v === "object" && "value" in v) return Boolean(v.value);
    if (v !== undefined) return Boolean(v);
    return true;
  });
  const showErrorDetailsEnabled = computed(() => {
    const v = errorPrefs?.showErrorDetails;
    if (v && typeof v === "object" && "value" in v) return Boolean(v.value);
    if (v !== undefined) return Boolean(v);
    return true;
  });

  const LOCAL_STATUS = Object.freeze({ SENDING: "sending", FAILED: "failed" });

  function ensureChatList() {
    const list = chat && typeof chat === "object" ? chat.value : null;
    if (Array.isArray(list)) return list;
    if (chat && typeof chat === "object") chat.value = [];
    return chat && typeof chat === "object" && Array.isArray(chat.value) ? chat.value : [];
  }

  function findLocalUserMessageByRequestId(requestId) {
    const rid = String(requestId || "").trim();
    if (!rid) return null;
    const list = ensureChatList();
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const m = list[i];
      if (m?.role !== "user") continue;
      if (String(m?.localRequestId || "").trim() !== rid) continue;
      return m;
    }
    return null;
  }

  function appendLocalUserMessage({ requestId, userText }) {
    const rid = String(requestId || "").trim();
    const text = String(userText || "").trim();
    if (!rid || !text) return;
    const msg = { role: "user", content: text, time: nowTime(), localRequestId: rid, localStatus: LOCAL_STATUS.SENDING, localError: "", localErrorDetail: "" };
    ensureChatList().push(msg);
  }

  function markLocalUserMessageSending(requestId) {
    const m = findLocalUserMessageByRequestId(requestId);
    if (!m) return;
    m.localStatus = LOCAL_STATUS.SENDING;
    m.localError = "";
  }

  function markLocalUserMessageFailed({ requestId, errorText, errorDetail }) {
    const m = findLocalUserMessageByRequestId(requestId);
    if (!m) return;
    m.localStatus = LOCAL_STATUS.FAILED;
    m.localError = String(errorText || "");
    m.localErrorDetail = String(errorDetail || m.localError || "");
  }

  function clearLocalUserMessageStatus(requestId) {
    const m = findLocalUserMessageByRequestId(requestId);
    if (!m) return;
    m.localStatus = "";
    m.localError = "";
    m.localErrorDetail = "";
  }

  function pushTurnEvent(type, data, sseId) {
    if (typeof pushEvent !== "function") return;
    pushEvent({ scope: "turn", type, data, sseId });
  }

  function pickFinalEventPayload(out) {
    const o = out && typeof out === "object" ? out : {};
    return {
      ok: o.ok,
      requestId: o.requestId,
      draftId: o.draftId,
      baseVersion: o.baseVersion,
      version: o.version,
      paused: o.paused,
      pauseReason: o.pauseReason,
      readRounds: o.readRounds,
      changedPaths: o.changedPaths,
      runLog: o.runLog,
    };
  }

  function pickErrorEventPayload(err) {
    return {
      code: err?.code,
      message: String(err?.message || err || "请求失败"),
      requestId: err?.requestId,
      draftId: err?.draftId,
      details: err?.details,
    };
  }
  function buildRetryHintForVersionConflict(err) {
    const base = err?.details?.baseVersion;
    const latest = err?.details?.latestVersion;
    const tip = base && latest ? `（base=${base}, latest=${latest}）` : "";
    return `版本冲突：请先点击“从看板重新解析”同步后再重试。${tip}`.trim();
  }
  function providerLabel(providerKey) {
    const p = String(providerKey || "").trim();
    const map = { openai: "OpenAI 兼容", claude: "Claude 兼容", makersuite: "Gemini（AI Studio）", vertexai: "Gemini（Vertex）" };
    return map[p] || p || "模型服务";
  }

  function pickProviderFromError(err) {
    const p = String(err?.details?.provider || "").trim();
    return p || String(provider.value || "").trim();
  }

  function buildErrorDetailText(err) {
    const lines = [];
    const code = String(err?.code || "").trim();
    const errorType = String(err?.details?.errorType || "").trim();
    const stage = String(err?.details?.stage || "").trim();
    const p = pickProviderFromError(err);
    const modelName = String(err?.details?.model || "").trim();
    const upstreamStatus = Number(err?.details?.upstreamStatus);
    const httpStatus = Number(err?.status ?? err?.details?.httpStatus);
    const requestId = String(err?.requestId || "").trim();

    if (code) lines.push(`code=${code}`);
    if (errorType) lines.push(`errorType=${errorType}`);
    if (stage) lines.push(`stage=${stage}`);
    if (p) lines.push(`provider=${p}`);
    if (modelName) lines.push(`model=${modelName}`);
    if (Number.isFinite(upstreamStatus) && upstreamStatus > 0) lines.push(`upstreamStatus=${upstreamStatus}`);
    if (Number.isFinite(httpStatus) && httpStatus > 0) lines.push(`httpStatus=${httpStatus}`);
    if (requestId) lines.push(`requestId=${requestId}`);

    const msg = String(err?.message || "").trim();
    if (msg) lines.push(`message=${msg}`);
    const upstreamMsg = String(err?.details?.upstreamMessage || "").trim();
    if (upstreamMsg && upstreamMsg !== msg) lines.push(`upstreamMessage=${upstreamMsg}`);

    return lines.join("\n").trim();
  }

  function buildTurnErrorTexts(err) {
    const code = String(err?.code || "").trim();
    if (code === "VERSION_CONFLICT") {
      return { text: buildRetryHintForVersionConflict(err), detail: showErrorDetailsEnabled.value ? buildErrorDetailText(err) : "" };
    }
    if (code === "DRAFT_BUSY") {
      return { text: "草稿存在进行中的 Run：请先停止 Run 再重试。", detail: showErrorDetailsEnabled.value ? buildErrorDetailText(err) : "" };
    }
    if (code === "DRAFT_PENDING") {
      return { text: "草稿存在待处理项：请先处理后再继续。", detail: showErrorDetailsEnabled.value ? buildErrorDetailText(err) : "" };
    }

    if (!humanizeErrorsEnabled.value) {
      return { text: `请求异常：${String(err?.message || err)}`, detail: showErrorDetailsEnabled.value ? buildErrorDetailText(err) : "" };
    }

    const errorType = String(err?.details?.errorType || "").trim();
    if (errorType === "upstream" || code === "UPSTREAM_ERROR") {
      const p = pickProviderFromError(err);
      const status = Number(err?.details?.upstreamStatus);
      const statusText = Number.isFinite(status) && status > 0 ? `（HTTP ${status}）` : "";
      return {
        text: [
          `${providerLabel(p)}返回错误或暂时不可用${statusText}。`,
          "你可以检查：API Key/余额与权限、模型名、Base URL、网络，或稍后重试。",
        ].join("\n"),
        detail: showErrorDetailsEnabled.value ? buildErrorDetailText(err) : "",
      };
    }

    const isModelOutputLike =
      errorType === "model_output" ||
      code.startsWith("MODEL_OUTPUT_") ||
      code.startsWith("PATCH_") ||
      code.startsWith("READ_") ||
      code === "MODE_FORBIDDEN";
    if (isModelOutputLike) {
      return {
        text: [
          "模型已回复，但内容未按工具格式输出，系统暂时无法应用改动。",
          "可点击“重试”，或让模型“只输出一个 <tool_use>，不要额外解释”。",
        ].join("\n"),
        detail: showErrorDetailsEnabled.value ? buildErrorDetailText(err) : "",
      };
    }

    return { text: `请求异常：${String(err?.message || err)}`, detail: showErrorDetailsEnabled.value ? buildErrorDetailText(err) : "" };
  }

  async function runNonStreamOnce({ base, upstream, input }) {
    const out = await turnApiV1Vcard({ ...input, baseVersion: base, upstream, model: normalizeText(model.value) || "" });
    pushTurnEvent("final", pickFinalEventPayload(out), "");
    if (out?.paused) return { type: "paused", out, extras: [] };
    return { type: "final", out, extras: [] };
  }

  async function runTurnWithAutoRetry({ base, upstream, input, streamEnabled }) {
    const runOnce = async (reqInput) => {
      if (streamEnabled) {
        return await runStreamTurnOnce({
          base,
          upstream,
          input: reqInput,
          model: model.value,
          chatRef: chat,
          readFocusPathsRef: readFocusPaths,
          beforeDraft: draftApi.draft.value,
          pushTurnEvent,
          pickFinalEventPayload,
          pickErrorEventPayload,
          signal: abortController?.signal,
        });
      }
      return await runNonStreamOnce({ base, upstream, input: reqInput });
    };

    try {
      return await runOnce(input);
    } catch (err) {
      if (!isRetryableVcardError(err)) throw err;

      const retryReason = buildRetryReason({ err, draft: draftApi.draft.value });
      const retryInput = { ...input, intent: "retry", userText: "", reason: retryReason };
      return await runOnce(retryInput);
    }
  }

  function cancelSend() {
    if (!sending.value) return;
    stopping.value = true;
    sendToken += 1;
    clearLocalUserMessageStatus(lastTurnAction.value?.requestId);
    if (abortController) abortController.abort();
  }

  function isNoToolStop(out) {
    const kinds = Array.isArray(out?.runLog?.kinds) ? out.runLog.kinds : [];
    return kinds.length === 0;
  }

  async function runTurnsWithFirst({ first }) {
    draftApi.boardError.value = "";
    draftApi.lastApply.value = null;

    if (sending.value) return;

    const id = String(draftApi.draftId.value || "");
    const base = Number(draftApi.draftVersion.value) || 0;
    if (!id || base < 1) return (draftApi.boardError.value = "草稿未就绪：请先初始化看板。");

    const upstream = buildUpstream({ api, provider: provider.value });
    if (String(upstream.provider || "") === "openai" && !String(upstream.baseUrl || "").trim()) {
      return (draftApi.boardError.value = "OpenAI Base URL 不能为空。");
    }

    sending.value = true;
    try {
      await runAutoTurns({ draftId: id, upstream, first });
    } catch (err) {
      const out = buildTurnErrorTexts(err);
      draftApi.boardError.value = out.text;
      pushTurnEvent("error", pickErrorEventPayload(err), err?.eventId);
      pushRunLog(runLog, buildFailRunLogItem({ mode: MODE, error: draftApi.boardError.value }));
      throw err;
    } finally {
      sending.value = false;
      if (abortController) abortController.abort();
      abortController = null;
      stopping.value = false;
    }
  }

  async function runWithoutUserInput() {
    try {
      await runTurnsWithFirst({ first: { requestId: createRequestId(), mode: MODE, intent: "run", reason: "", userText: "" } });
    } catch {
      // runTurnsWithFirst 已写入 boardError/runLog/event；此处不再重复处理。
    }
  }

  async function runWithUserText({ userText }) {
    const text = String(userText || "").trim();
    if (!text) return;
    if (sending.value) return;

    const id = String(draftApi.draftId.value || "");
    const base = Number(draftApi.draftVersion.value) || 0;
    if (!id || base < 1) return (draftApi.boardError.value = "草稿未就绪：请先初始化看板。");

    const upstream = buildUpstream({ api, provider: provider.value });
    if (String(upstream.provider || "") === "openai" && !String(upstream.baseUrl || "").trim()) {
      return (draftApi.boardError.value = "OpenAI Base URL 不能为空。");
    }

    const requestId = createRequestId();
    prepareSendAction({ draftId: id, userText: text, requestId, streamEnabled: Boolean(ui?.stream) });
    appendLocalUserMessage({ requestId, userText: text });
    try {
      await runTurnsWithFirst({ first: { requestId, mode: MODE, intent: "run", reason: "", userText: text } });
    } catch (err) {
      recordSendFailure(err);
    }
  }

  async function runAutoTurns({ draftId, upstream, first }) {
    const token = (sendToken += 1);
    abortController = new AbortController();
    stopping.value = false;
    for (let turnIndex = 1; ; turnIndex += 1) {
      if (token !== sendToken) return;

      const base = Number(draftApi.draftVersion.value) || 0;
      if (base < 1) throw new Error("草稿未就绪：请先初始化看板。");

      const reqId = turnIndex === 1 ? normalizeText(first?.requestId) || createRequestId() : createRequestId();
      const payload =
        turnIndex === 1
          ? { ...first, requestId: reqId, draftId, mode: MODE, presetName: "", ctx }
          : { requestId: reqId, draftId, mode: MODE, intent: "run", reason: "", userText: "", presetName: "", ctx };

      const streamEnabled = Boolean(ui?.stream);
      let res;
      try {
        res = await runTurnWithAutoRetry({ base, upstream, input: payload, streamEnabled });
      } catch (err) {
        if (token !== sendToken) break;
        if (abortController?.signal?.aborted) break;
        throw err;
      }

      if (res.type === "paused") {
        await applyPausedFinal(res.out);
        return;
      }

      const beforeDraft = res.beforeDraft ?? draftApi.draft.value;
      await applyTurnFinal({ draftApi, runLogRef: runLog, beforeDraft, out: res.out, extras: res.extras || [], mode: MODE });
      lastTurnError.value = null;

      // 未调用任何工具（纯文本输出）：视为“与用户对话/提问”，停止 Auto，避免空转。
      if (isNoToolStop(res.out)) return;
    }
  }

  async function applyPausedFinal(out) {
    const reason = String(out?.pauseReason || "").trim();
    // 审批型暂停：plan_review/patch_review 不会 apply 草稿版本，需用户通过 pending 动作继续。
    if (reason === "plan_review") draftApi.boardError.value = "已生成待审批计划（plan_review）：请在右侧 Pending 面板进行 批准/驳回/追问。";
    else if (reason === "patch_review")
      draftApi.boardError.value = "已生成待确认变更（patch_review）：系统将尝试自动处理；若未自动处理，请在右侧 Pending 面板进行 Accept/Reject/追问。";
    else draftApi.boardError.value = `已暂停：${reason || "unknown"}。`;

    if ((reason === "plan_review" || reason === "patch_review") && typeof onReviewPaused === "function") {
      await onReviewPaused().catch(() => undefined);
    }
  }

  function prepareSendAction({ draftId, userText, requestId, streamEnabled }) {
    lastTurnAction.value = { type: "turn", at: nowTime(), draftId, mode: MODE, userText, requestId, streamEnabled: Boolean(streamEnabled) };
    lastTurnError.value = null;
  }

  function recordSendFailure(err) {
    const reqId = String(lastTurnAction.value?.requestId || err?.requestId || "").trim();
    const out = buildTurnErrorTexts(err);
    const errorText = out.text;
    const payload = pickErrorEventPayload(err);
    lastTurnError.value = { ...payload, requestId: reqId || payload.requestId, message: errorText, at: nowTime() };
    markLocalUserMessageFailed({ requestId: reqId, errorText, errorDetail: out.detail });
  }

  async function sendMessage() {
    draftApi.boardError.value = "";
    draftApi.lastApply.value = null;

    const text = userInput.value.trim();
    if (!text) return;

    const id = String(draftApi.draftId.value || "");
    const base = Number(draftApi.draftVersion.value) || 0;
    if (!id || base < 1) return (draftApi.boardError.value = "草稿未就绪：请先初始化看板。");

    const upstream = buildUpstream({ api, provider: provider.value });
    if (String(upstream.provider || "") === "openai" && !String(upstream.baseUrl || "").trim()) {
      return (draftApi.boardError.value = "OpenAI Base URL 不能为空。");
    }

    const requestId = createRequestId();
    const streamEnabled = Boolean(ui?.stream);
    prepareSendAction({ draftId: id, userText: text, requestId, streamEnabled });
    appendLocalUserMessage({ requestId, userText: text });

    userInput.value = "";
    try {
      await runTurnsWithFirst({ first: { requestId, mode: MODE, intent: "run", reason: "", userText: text } });
    } catch (err) {
      recordSendFailure(err);
    }
  }

  async function retryLastTurn() {
    if (sending.value) return;

    draftApi.boardError.value = "";
    draftApi.lastApply.value = null;

    const last = lastTurnAction.value;
    const requestId = String(last?.requestId || "").trim();
    const text = String(last?.userText || "").trim();
    if (!requestId || !text) return;

    const id = String(draftApi.draftId.value || "");
    const base = Number(draftApi.draftVersion.value) || 0;
    if (!id || base < 1) return (draftApi.boardError.value = "草稿未就绪：请先初始化看板。");

    const upstream = buildUpstream({ api, provider: provider.value });
    if (String(upstream.provider || "") === "openai" && !String(upstream.baseUrl || "").trim()) {
      return (draftApi.boardError.value = "OpenAI Base URL 不能为空。");
    }

    lastTurnError.value = null;
    markLocalUserMessageSending(requestId);
    try {
      await runTurnsWithFirst({ first: { requestId, mode: MODE, intent: "run", reason: "", userText: text } });
    } catch (err) {
      recordSendFailure(err);
    }
  }

  return {
    userInput,
    sending,
    stopping,
    runLog,
    lastTurnAction,
    lastTurnError,
    runWithoutUserInput,
    runWithUserText,
    cancelSend,
    sendMessage,
    retryLastTurn,
  };
}
