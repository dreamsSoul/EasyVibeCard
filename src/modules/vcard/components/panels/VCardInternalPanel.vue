<!--
文件：VCardInternalPanel.vue
模块：角色卡设计器
作用：内部信息面板（草稿看板/控制消息/Read/运行日志）收敛入口，默认折叠
依赖：VCardReadCard、VCardRunLogPanel、vcard/domain
@created 2026-01-10
@modified 2026-01-20
-->

<template>
  <details class="vcardInternal">
    <summary class="vcardInternal__summary">
      <span>内部信息</span>
      <span class="vcardInternal__badges">
        <span class="vcardInternal__badge" v-if="eventCount">事件 {{ eventCount }}</span>
        <span class="vcardInternal__badge" v-if="ctrlCount">控制 {{ ctrlCount }}</span>
        <span class="vcardInternal__badge" v-if="readCount">Read {{ readCount }}</span>
        <span class="vcardInternal__badge" v-if="logCount">日志 {{ logCount }}</span>
      </span>
    </summary>

    <div class="vcardInternal__body">
      <details class="vcardInternal__section" v-if="eventCount">
        <summary class="vcardInternal__sectionSummary">事件（{{ eventCount }}）</summary>
        <div class="vcardInternal__toolbar">
          <select v-model="scopeFilter" class="input input--sm" title="按 scope 过滤">
            <option value="all">全部 scope</option>
            <option v-for="s in scopeOptions" :key="s" :value="s">{{ s }}</option>
          </select>
          <select v-model="typeFilter" class="input input--sm" title="按 type 过滤">
            <option value="all">全部 type</option>
            <option v-for="t in typeOptions" :key="t" :value="t">{{ t }}</option>
          </select>
          <button class="btn" :disabled="eventCount === 0" @click="$emit('clearEventLog')">清空事件</button>
        </div>
        <div class="vcardInternal__list">
          <details v-for="(e, idx) in filteredEvents" :key="e.id || idx" class="vcardInternal__event">
            <summary class="vcardInternal__eventSummary">
              <span class="vcardInternal__mono">{{ e.at }}</span>
              <span v-if="e.scope" class="vcardInternal__badge muted">{{ e.scope }}</span>
              <span class="vcardInternal__badge">{{ e.type }}</span>
              <span v-if="e.sseId" class="vcardInternal__mono">#{{ e.sseId }}</span>
              <span v-if="e.summary" class="vcardInternal__mono">{{ e.summary }}</span>
            </summary>
            <pre class="code vcardInternal__code">{{ formatJson(e.data) }}</pre>
          </details>
        </div>
      </details>

      <details class="vcardInternal__section" v-if="boardText">
        <summary class="vcardInternal__sectionSummary">原始看板</summary>
        <pre class="code vcardInternal__code">{{ boardText }}</pre>
      </details>

      <details class="vcardInternal__section" v-if="ctrlCount">
        <summary class="vcardInternal__sectionSummary">控制消息（{{ ctrlCount }}）</summary>
        <div class="vcardInternal__list">
          <div v-for="(m, idx) in ctrlMsgs" :key="idx" class="vcardInternal__msg">
            <div class="vcardInternal__msgMeta">
              <span class="vcardInternal__mono">{{ m.time }}</span>
              <span class="vcardInternal__badge muted">user</span>
            </div>
            <pre class="code vcardInternal__code">{{ m.content }}</pre>
          </div>
        </div>
      </details>

      <details class="vcardInternal__section" v-if="readCount">
        <summary class="vcardInternal__sectionSummary">Read（{{ readCount }}）</summary>
        <div class="vcardInternal__list">
          <div v-for="(m, idx) in readMsgs" :key="idx" class="vcardInternal__msg">
            <div class="vcardInternal__msgMeta">
              <span class="vcardInternal__mono">{{ m.time }}</span>
              <span class="vcardInternal__badge muted">assistant</span>
            </div>
            <VCardReadCard v-if="m.parsed && m.parsed.ok" :type="m.parsed.type" :data="m.parsed.data" @navigate="$emit('navigateToFile', $event)" />
            <pre v-else class="code vcardInternal__code">{{ m.content }}</pre>
          </div>
        </div>
      </details>

      <VCardRunLogPanel v-if="logCount" :runLog="runLogList" @clear="$emit('clearRunLog')" />

      <div v-if="!eventCount && !boardText && !ctrlCount && !readCount && !logCount" class="vcardInternal__empty">（暂无内部信息）</div>
    </div>
  </details>
</template>

<script setup>
import { computed, ref } from "vue";
import { isVcardControlMessageText } from "../../domain/controlMessage";
import { isVcardReadDisplayMessageText, parseVcardReadDisplayMessage } from "../../domain/readProtocol";
import VCardReadCard from "../cards/VCardReadCard.vue";
import VCardRunLogPanel from "./VCardRunLogPanel.vue";

const props = defineProps({
  chat: { type: Array, required: true },
  runLog: { type: Array, default: () => [] },
  eventLog: { type: Array, default: () => [] },
});

defineEmits(["navigateToFile", "clearRunLog", "clearEventLog"]);

const boardText = computed(() => String(props.chat?.[0]?.role === "assistant" ? props.chat?.[0]?.content || "" : ""));
const rawChat = computed(() => (Array.isArray(props.chat) ? props.chat.slice(1) : []));

const scopeFilter = ref("all");
const typeFilter = ref("all");
const eventList = computed(() => (Array.isArray(props.eventLog) ? props.eventLog : []));
const eventCount = computed(() => eventList.value.length);
const scopeOptions = computed(() => {
  const set = new Set();
  eventList.value.forEach((e) => set.add(String(e?.scope || "").trim()));
  return Array.from(set).filter(Boolean).sort();
});
const typeOptions = computed(() => {
  const set = new Set();
  eventList.value.forEach((e) => set.add(String(e?.type || "").trim()));
  return Array.from(set).filter(Boolean).sort();
});
const filteredEvents = computed(() =>
  eventList.value.filter((e) => {
    if (scopeFilter.value !== "all" && String(e?.scope || "") !== scopeFilter.value) return false;
    if (typeFilter.value !== "all" && String(e?.type || "") !== typeFilter.value) return false;
    return true;
  })
);

const ctrlMsgs = computed(() =>
  rawChat.value
    .filter((m) => m?.role === "user" && isVcardControlMessageText(m?.content))
    .map((m) => ({ role: m.role, time: String(m.time || ""), content: String(m.content || "") }))
);
const readMsgs = computed(() =>
  rawChat.value
    .filter((m) => m?.role === "assistant" && isVcardReadDisplayMessageText(m?.content))
    .map((m) => ({ role: m.role, time: String(m.time || ""), content: String(m.content || ""), parsed: parseVcardReadDisplayMessage(String(m.content || "")) }))
);

const ctrlCount = computed(() => ctrlMsgs.value.length);
const readCount = computed(() => readMsgs.value.length);
const runLogList = computed(() => (Array.isArray(props.runLog) ? props.runLog : []));
const logCount = computed(() => runLogList.value.length);

function formatJson(value) {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value ?? "");
  }
}
</script>

<style scoped>
.vcardInternal {
  margin: 8px 0 10px;
  border: 1px solid var(--border-color, #3a3a4a);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
}

.vcardInternal__summary {
  padding: 10px 12px;
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--text-primary, #e0e0e0);
  font-weight: 600;
}

.vcardInternal__badges {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.vcardInternal__badge {
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(120, 120, 150, 0.25);
  color: var(--text-primary, #e0e0e0);
  font-size: 12px;
  font-weight: 600;
}

.vcardInternal__badge.muted {
  background: rgba(120, 120, 150, 0.12);
  color: var(--text-secondary, #bbb);
}

.vcardInternal__body {
  padding: 10px 12px;
  border-top: 1px solid var(--border-color, #3a3a4a);
  max-height: 280px;
  overflow: auto;
}

.vcardInternal__section {
  margin: 8px 0;
}

.vcardInternal__sectionSummary {
  cursor: pointer;
  color: var(--text-secondary, #bbb);
  user-select: none;
}

.vcardInternal__list {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.vcardInternal__toolbar {
  margin-top: 8px;
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  flex-wrap: wrap;
}

.vcardInternal__event {
  border: 1px solid rgba(120, 120, 150, 0.22);
  border-radius: 10px;
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.02);
}

.vcardInternal__eventSummary {
  cursor: pointer;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
  user-select: none;
}

.vcardInternal__msgMeta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.vcardInternal__mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 12px;
  color: var(--text-secondary, #888);
}

.vcardInternal__code {
  max-height: 240px;
  overflow: auto;
}

.vcardInternal__empty {
  color: var(--text-secondary, #888);
  padding: 6px 0;
}
</style>
