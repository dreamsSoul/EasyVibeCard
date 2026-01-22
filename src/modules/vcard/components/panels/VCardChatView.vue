<!--
文件：VCardChatView.vue
模块：角色卡设计器
作用：Agent 对话视图（隐藏 chatHistory[0] 看板；展示 Vibe 步骤、Read、审批与输入框）
依赖：VCardStepper、VCardPendingPanel、VCardReadCard、vcard/domain
@created 2025-12-29
@modified 2026-01-21
-->

<template>
  <div class="chatView vcardChatView">
    <header class="chatView__header vcardChatHeader">
      <div class="chatView__title">Agent</div>
      <details ref="menuRef" class="vcardChatMenu">
        <summary class="vcardChatMenu__trigger" title="更多">+</summary>
        <div class="vcardChatMenu__panel">
          <button type="button" class="vcardChatMenu__item" :disabled="sending || pendingBusy || pendingBlocked" @click="onMenuReplan">
            重新规划（保留产物）
          </button>
          <button type="button" class="vcardChatMenu__item" :disabled="sending || pendingBusy || pendingBlocked" @click="onMenuAdvanceTask">
            标记当前任务完成
          </button>
          <button type="button" class="vcardChatMenu__item" @click="onToggleShowRead">
            {{ showRead ? "隐藏 Read（内部）" : "显示 Read（内部）" }}
          </button>
          <button type="button" class="vcardChatMenu__item" :disabled="sending || chat.length === 0" @click="onMenuClear">
            清空对话
          </button>
        </div>
      </details>
    </header>

    <div class="chatView__body">
      <div class="chatList" ref="chatListRef">
        <div v-if="visibleChat.length === 0" class="chatList__empty">还没有消息，发送一条试试～</div>
        <div v-for="(m, idx) in visibleChat" :key="idx" class="chatMsg" :class="m.role">
          <div class="chatMsg__meta">
            <span class="chatMsg__role">{{ m.role }}</span>
            <span class="chatMsg__metaRight">
              <span class="chatMsg__time">{{ m.time }}</span>
              <span v-if="statusText(m)" class="chatMsg__status" :class="statusClass(m)">{{ statusText(m) }}</span>
            </span>
          </div>
          <template v-if="isReadMessage(m)">
            <VCardReadCard v-if="readParsed(m) && readParsed(m).ok" :type="readParsed(m).type" :data="readParsed(m).data" :ctx="ctx" @navigate="$emit('navigateToFile', $event)" />
            <div v-else class="chatMsg__content">{{ displayMessageContent(m) }}</div>
          </template>
          <div v-else class="chatMsg__content">{{ displayMessageContent(m) }}</div>
          <div v-if="isUserFailed(m) && m.localError" class="chatMsg__error" :title="String(m.localError || '')">
            {{ summarizeErrorText(m.localError) }}
          </div>
          <div v-if="idx === lastFailedUserIdx && isUserFailed(m) && canRetryLastAction" class="chatMsg__retryRow">
            <button class="btn chatMsg__retryBtn" :disabled="sending || pendingBusy || pendingBlocked" @click="onRetryLastActionClick">重试</button>
          </div>
        </div>
      </div>

      <VCardStepper :progress="progress" />

      <VCardPendingPanel
        v-if="pendingBlocked"
        :pending="pending"
        :busy="pendingBusy || sending || stopping"
        @approvePlan="$emit('approvePendingPlan')"
        @rejectPlan="$emit('rejectPendingPlan')"
        @acceptPatch="$emit('acceptPendingPatch')"
        @rejectPatch="$emit('rejectPendingPatch')"
        @ask="$emit('askPending', $event)"
      />

      <div class="composer vcardComposer">
        <div class="composer__toolbar">
          <div class="composer__toolbarSpacer"></div>

          <button v-if="sending" class="btn btn--danger" :disabled="stopping" title="停止本次发送" @click="$emit('cancelSend')">
            {{ stopping ? "停止中…" : "停止" }}
          </button>
          <button class="btn btn--primary" :disabled="sending || pendingBusy || pendingBlocked || !modelValue.trim()" @click="onPrimaryClick">
            {{ sending ? "发送中…" : "发送" }}
          </button>
        </div>

        <textarea
          :value="modelValue"
          rows="3"
          class="composer__input"
          :placeholder="placeholderText"
          @input="$emit('update:modelValue', $event.target.value)"
          @keydown="onComposerKeydown"
        ></textarea>

        <div class="composer__actions">
          <button v-if="canRetryLastAction" class="btn" :disabled="sending || pendingBusy || pendingBlocked" :title="retryLastActionTitle" @click="onRetryLastActionClick">
            重试上一次
          </button>
          <button v-if="canRestoreInput" class="btn" :disabled="sending || pendingBusy || pendingBlocked" :title="restoreInputTitle" @click="$emit('restoreInput')">
            恢复输入
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { isVcardControlMessageText } from "../../domain/controlMessage";
import { VCARD_READ_PREFIX, VCARD_READ_RESULT_PREFIX, isVcardReadDisplayMessageText, parseVcardReadDisplayMessage } from "../../domain/readProtocol";
import VCardReadCard from "../cards/VCardReadCard.vue";
import VCardPendingPanel from "./VCardPendingPanel.vue";
import VCardStepper from "./VCardStepper.vue";

const props = defineProps({
  chat: { type: Array, required: true },
  ctx: { type: Object, default: null },
  modelValue: { type: String, required: true },
  sending: { type: Boolean, default: false },
  stopping: { type: Boolean, default: false },
  progress: { type: Object, default: null },
  canRestoreInput: { type: Boolean, default: false },
  restoreInputTitle: { type: String, default: "" },
  canRetryLastAction: { type: Boolean, default: false },
  retryLastActionTitle: { type: String, default: "" },
  pending: { type: Object, default: null },
  pendingBusy: { type: Boolean, default: false },
});

const emit = defineEmits([
  "update:modelValue",
  "send",
  "cancelSend",
  "replanKeepArtifacts",
  "manualAdvanceCurrentTask",
  "approvePendingPlan",
  "rejectPendingPlan",
  "acceptPendingPatch",
  "rejectPendingPatch",
  "askPending",
  "restoreInput",
  "retryLastAction",
  "clear",
  "navigateToFile",
]);

const menuRef = ref(null);
const SHOW_READ_KEY = "vcard.chat.showRead";
const showRead = ref(false);

try {
  showRead.value = localStorage.getItem(SHOW_READ_KEY) === "1";
} catch {
  // localStorage 不可用时降级为默认隐藏
}

const rawChat = computed(() => (Array.isArray(props.chat) ? props.chat.slice(1) : []));
const visibleChat = computed(() =>
  rawChat.value.filter((m) => {
    if (m?.role === "user" && isVcardControlMessageText(m?.content)) return false;
    if (!showRead.value && m?.role === "assistant" && isVcardReadDisplayMessageText(m?.content)) return false;
    return true;
  })
);
const lastFailedUserIdx = computed(() => {
  for (let i = visibleChat.value.length - 1; i >= 0; i -= 1) {
    const m = visibleChat.value[i];
    if (String(m?.role || "") !== "user") continue;
    if (String(m?.localStatus || "") !== "failed") continue;
    return i;
  }
  return -1;
});

const chatListRef = ref(null);
const pendingKind = computed(() => String(props.pending?.kind || "").trim());
const pendingBlocked = computed(() => pendingKind.value === "plan_review" || pendingKind.value === "patch_review");
const placeholderText = computed(() => {
  if (pendingBlocked.value) return "存在待审批项：请先在上方处理（Approve/Reject/Accept/追问）";
  return "输入消息（Ctrl/⌘ + Enter 发送）";
});

function closeMenu() {
  if (menuRef.value) menuRef.value.open = false;
}

function onMenuClear() {
  emit("clear");
  closeMenu();
}

function onMenuReplan() {
  if (!confirm("确定重新规划吗？\n\n- 将清空 vibePlan（任务清单）\n- 保留当前角色卡内容/产物\n- 对话记录保留")) return;
  emit("replanKeepArtifacts");
  closeMenu();
}

function onMenuAdvanceTask() {
  emit("manualAdvanceCurrentTask");
  closeMenu();
}

function onToggleShowRead() {
  showRead.value = !showRead.value;
  try {
    localStorage.setItem(SHOW_READ_KEY, showRead.value ? "1" : "0");
  } catch {
    // ignore
  }
  closeMenu();
}

function onPrimaryClick() {
  if (props.sending) return;
  if (pendingBlocked.value || props.pendingBusy) return;
  if (!props.modelValue.trim()) return;
  return emit("send");
}

function onRetryLastActionClick() {
  if (props.sending) return;
  if (pendingBlocked.value || props.pendingBusy) return;
  if (props.modelValue.trim()) {
    if (!confirm("当前输入框已有内容：将重试上一次发送内容，并忽略输入框内容。确定继续吗？")) return;
  }
  return emit("retryLastAction");
}

function isUserSending(m) {
  return String(m?.role || "") === "user" && String(m?.localStatus || "") === "sending";
}

function isUserFailed(m) {
  return String(m?.role || "") === "user" && String(m?.localStatus || "") === "failed";
}

function statusText(m) {
  if (isUserSending(m)) return "发送中";
  if (isUserFailed(m)) return "失败";
  return "";
}

function statusClass(m) {
  if (isUserSending(m)) return "is-sending";
  if (isUserFailed(m)) return "is-failed";
  return "";
}

function summarizeErrorText(text) {
  const s = String(text || "").trim();
  if (s.length <= 60) return s;
  return `${s.slice(0, 60)}…`;
}

function stripUserInputPrefix(text) {
  const s = String(text || "");
  const prefix = "【USER_INPUT】";
  if (!s.startsWith(prefix)) return s;
  let out = s.slice(prefix.length);
  if (out.startsWith("\r\n")) out = out.slice(2);
  else if (out.startsWith("\n")) out = out.slice(1);
  return out;
}

function stripInjectedUserTags(text) {
  const s = String(text || "");
  if (s.startsWith("【USER_INPUT】")) return stripUserInputPrefix(s);
  if (s.startsWith("【VCARD_TODO】")) {
    const idx = s.indexOf("【USER_INPUT】");
    if (idx >= 0) return stripUserInputPrefix(s.slice(idx));
  }
  return s;
}

function stripVcardReadPrefixForDisplay(text) {
  const s = String(text || "");
  const hit = s.startsWith(VCARD_READ_PREFIX) ? VCARD_READ_PREFIX : s.startsWith(VCARD_READ_RESULT_PREFIX) ? VCARD_READ_RESULT_PREFIX : "";
  if (!hit) return s;
  let out = s.slice(hit.length);
  if (out.startsWith("\r\n")) out = out.slice(2);
  else if (out.startsWith("\n")) out = out.slice(1);
  return out;
}

function displayMessageContent(m) {
  const role = String(m?.role || "");
  const content = String(m?.content || "");
  if (role === "user") return stripInjectedUserTags(content);
  if (role === "assistant" && isVcardReadDisplayMessageText(content)) return stripVcardReadPrefixForDisplay(content);
  return content;
}

function isReadMessage(m) {
  return String(m?.role || "") === "assistant" && isVcardReadDisplayMessageText(m?.content);
}

function readParsed(m) {
  return parseVcardReadDisplayMessage(String(m?.content || ""));
}

async function scrollToBottom() {
  await nextTick();
  const el = chatListRef.value;
  if (el) el.scrollTop = el.scrollHeight;
}

watch(
  () => {
    const last = visibleChat.value?.[visibleChat.value.length - 1];
    return `${visibleChat.value.length}:${String(last?.role || "")}:${String(last?.content || "").length}:${String(last?.localStatus || "")}:${String(last?.localError || "").length}`;
  },
  () => scrollToBottom()
);

function onComposerKeydown(e) {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (props.sending) return;
    if (pendingBlocked.value || props.pendingBusy) return;
    if (!props.modelValue.trim()) return;
    return emit("send");
  }
}
</script>
