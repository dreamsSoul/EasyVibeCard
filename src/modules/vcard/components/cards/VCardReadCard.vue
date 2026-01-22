<!--
文件：VCardReadCard.vue
模块：角色卡设计器
作用：折叠式 Read 工具调用卡片（Cursor 风格）
依赖：vcard/domain/readProtocol
@created 2026-01-09
@modified 2026-01-21
-->

<template>
  <div class="readCard" :class="{ 'readCard--expanded': expanded, 'readCard--result': type === 'result' }">
    <div class="readCard__header" @click="toggle">
      <span class="readCard__icon">{{ type === 'request' ? '📖' : '📄' }}</span>
      <span class="readCard__title">{{ title }}</span>
      <span class="readCard__badge" v-if="itemCount > 0">{{ itemCount }}</span>
      <span class="readCard__toggle">{{ expanded ? '▼' : '▶' }}</span>
    </div>
    <div class="readCard__body" v-if="expanded">
      <div v-if="type === 'request'" class="readCard__items">
        <div v-for="(r, idx) in reads" :key="idx" class="readCard__item readCard__item--clickable" @click="navigateTo(r.path)">
          <span class="readCard__path">{{ r.path }}</span>
          <span class="readCard__meta" v-if="r.offset || r.limit">
            offset={{ r.offset || 0 }}, limit={{ r.limit || 1200 }}
          </span>
          <span class="readCard__nav">→</span>
        </div>
      </div>
      <div v-else-if="type === 'result'" class="readCard__items">
        <details v-for="(item, idx) in items" :key="idx" class="readCard__resultItem">
          <summary class="readCard__resultSummary" :class="{ 'is-error': item.error }">
            <span class="readCard__path">{{ item.path }}</span>
            <span class="readCard__meta" v-if="item.error">❌ {{ item.error }}</span>
            <span class="readCard__meta" v-else-if="item.type === 'string'">
              {{ item.totalLen }} chars, offset={{ item.offset || 0 }}, limit={{ item.limit || 1200 }}
              <template v-if="item.hasMore">(有更多)</template>
            </span>
            <span class="readCard__meta" v-else>{{ item.type }}</span>
            <button v-if="!item.error" type="button" class="readCard__navBtn" @click.stop="navigateTo(item.path)">打开</button>
          </summary>
          <div v-if="!item.error" class="readCard__resultBody">
            <pre v-if="item.type === 'string'" class="readCard__value">{{ renderStTemplateSafe(item.value, stVars) }}</pre>
            <pre v-else class="readCard__value">{{ formatJson(item.value) }}</pre>
          </div>
        </details>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from "vue";

const props = defineProps({
  type: { type: String, required: true }, // 'request' | 'result'
  data: { type: Object, required: true },
  ctx: { type: Object, default: null }, // 用于渲染 {{user}}/{{char}} 等变量（可选）
});

const emit = defineEmits(["navigate"]);

const expanded = ref(true);

const title = computed(() => props.type === "request" ? "Read 请求" : "Read 结果");
const reads = computed(() => Array.isArray(props.data?.reads) ? props.data.reads : []);
const items = computed(() => Array.isArray(props.data?.items) ? props.data.items : []);
const itemCount = computed(() => props.type === "request" ? reads.value.length : items.value.length);

function buildStTemplateVars(ctx) {
  const c = ctx && typeof ctx === "object" ? ctx : {};
  const user = String(c.user || "User");
  const char = String(c.char || "Assistant");
  return {
    user,
    char,
    group: char,
    groupNotMuted: char,
    charIfNotGroup: char,
    notChar: user,
    scenario: String(c.scenario || ""),
    personality: String(c.charPersonality || ""),
    description: String(c.charDescription || ""),
    persona: String(c.personaDescription || ""),
    mesExamples: String(c.dialogueExamples || ""),
  };
}

function renderStTemplateSafe(text, vars) {
  const v = vars && typeof vars === "object" ? vars : {};
  return String(text || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (full, key) => (Object.prototype.hasOwnProperty.call(v, key) ? String(v[key] ?? "") : full));
}

const stVars = computed(() => buildStTemplateVars(props.ctx));

function toggle() {
  expanded.value = !expanded.value;
}

function formatJson(value) {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function navigateTo(path) {
  if (!path) return;
  emit("navigate", path);
}
</script>

<style scoped>
.readCard {
  margin: 6px 0;
  border-radius: 8px;
  background: var(--card-bg, #1e1e2e);
  border: 1px solid var(--border-color, #3a3a4a);
  overflow: hidden;
  font-size: 13px;
}

.readCard--result {
  background: var(--card-result-bg, #1a2a1e);
  border-color: var(--border-result, #2a4a2e);
}

.readCard__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}

.readCard__header:hover {
  background: var(--card-hover, rgba(255, 255, 255, 0.05));
}

.readCard__icon {
  font-size: 14px;
}

.readCard__title {
  flex: 1;
  font-weight: 500;
  color: var(--text-primary, #e0e0e0);
}

.readCard__badge {
  background: var(--badge-bg, #4a4a5a);
  color: var(--badge-text, #fff);
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
}

.readCard__toggle {
  color: var(--text-secondary, #888);
  font-size: 10px;
  transition: transform 0.2s;
}

.readCard--expanded .readCard__toggle {
  transform: rotate(0deg);
}

.readCard__body {
  border-top: 1px solid var(--border-color, #3a3a4a);
  padding: 8px 12px;
}

.readCard__items {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.readCard__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background: var(--item-bg, rgba(255, 255, 255, 0.03));
  border-radius: 4px;
}

.readCard__item--error {
  background: var(--item-error-bg, rgba(255, 100, 100, 0.1));
  border: 1px solid var(--item-error-border, rgba(255, 100, 100, 0.3));
}

.readCard__path {
  flex: 1;
  font-family: monospace;
  color: var(--text-code, #a0c0ff);
  word-break: break-all;
}

.readCard__meta {
  color: var(--text-secondary, #888);
  font-size: 12px;
  white-space: nowrap;
}

.readCard__item--clickable {
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
}

.readCard__item--clickable:hover {
  background: var(--item-hover, rgba(255, 255, 255, 0.08));
  transform: translateX(2px);
}

.readCard__nav {
  color: var(--text-secondary, #888);
  font-size: 12px;
  opacity: 0;
  transition: opacity 0.15s;
}

.readCard__item--clickable:hover .readCard__nav {
  opacity: 1;
}

.readCard__resultItem {
  border: 1px solid rgba(120, 120, 150, 0.2);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  overflow: hidden;
}

.readCard__resultSummary {
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
}

.readCard__resultSummary.is-error {
  background: rgba(255, 100, 100, 0.08);
}

.readCard__resultSummary::-webkit-details-marker {
  display: none;
}

.readCard__navBtn {
  margin-left: auto;
  border: 1px solid var(--border-color, #3a3a4a);
  background: transparent;
  color: var(--text-secondary, #888);
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  cursor: pointer;
}

.readCard__navBtn:hover {
  color: var(--text-primary, #e0e0e0);
  background: rgba(255, 255, 255, 0.06);
}

.readCard__resultBody {
  border-top: 1px solid rgba(120, 120, 150, 0.2);
  padding: 8px 10px;
}

.readCard__value {
  margin: 0;
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 12px;
  color: var(--text-primary, #e0e0e0);
}
</style>
