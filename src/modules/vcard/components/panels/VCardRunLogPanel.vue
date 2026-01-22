<!--
文件：VCardRunLogPanel.vue
模块：角色卡设计器
作用：运行日志面板（筛选/搜索/展开详情），用于快速定位失败轮次与产物变更
依赖：无
@created 2025-12-31
@modified 2025-12-31
-->

<template>
  <details class="vcardLog" :open="runLog.length > 0">
    <summary class="vcardEditor__summary">运行日志（{{ runLog.length }}）</summary>

    <div class="vcardLog__toolbar">
      <select v-model="okFilter" class="input input--sm" title="按 OK/FAIL 过滤">
        <option value="all">全部</option>
        <option value="ok">OK</option>
        <option value="fail">FAIL</option>
      </select>

      <select v-model="modeFilter" class="input input--sm" title="按 mode 过滤">
        <option value="all">全部 mode</option>
        <option v-for="m in modeOptions" :key="m" :value="m">{{ m }}</option>
      </select>

      <input v-model="q" class="input input--search" placeholder="搜索：error / kind / path / note" />

      <button class="btn" :disabled="runLog.length === 0" @click="$emit('clear')">清空日志</button>
    </div>

    <div v-if="filtered.length === 0" class="vcardLog__empty">（无匹配项）</div>

    <details v-for="(x, idx) in filtered" :key="idx" class="vcardLogRow">
      <summary class="vcardLogRow__summary">
        <span class="vcardLogRow__badge" :class="x.ok ? 'ok' : 'fail'">{{ x.ok ? "OK" : "FAIL" }}</span>
        <span class="vcardLogRow__mono">{{ x.at }}</span>
        <span class="vcardLogRow__badge">{{ x.mode }}</span>
        <span class="vcardLogRow__mono">{{ stepText(x) }}</span>
        <span class="vcardLogRow__badge" :class="x.artifactChanged ? 'ok' : 'muted'">{{
          x.artifactChanged ? `变更 ${Number(x.changedPaths?.length || 0)}` : "无变更"
        }}</span>
        <span v-if="x.kinds?.length" class="vcardLogRow__mono">kinds={{ x.kinds.join("/") }}</span>
        <span v-if="!x.ok && x.error" class="vcardLogRow__err">{{ summarizeText(x.error) }}</span>
      </summary>

      <div class="vcardLogRow__body">
        <div class="vcardLogRow__meta">
          <span class="kv"><span class="k">StepName</span><span class="v">{{ String(x.stepNameBefore || "") }} -> {{ String(x.stepNameAfter || "") }}</span></span>
          <span class="kv"><span class="k">Chars</span><span class="v">{{ Number(x.assistantChars || 0) }}</span></span>
        </div>

        <div v-if="x.note" class="vcardLogRow__section">
          <div class="vcardLogRow__title">note</div>
          <pre class="pre">{{ x.note }}</pre>
        </div>

        <div v-if="!x.ok && x.error" class="vcardLogRow__section">
          <div class="vcardLogRow__title">error</div>
          <pre class="pre">{{ x.error }}</pre>
        </div>

        <div class="vcardLogRow__section">
          <div class="vcardLogRow__title">changedPaths（{{ Number(x.changedPaths?.length || 0) }}）</div>
          <pre class="code">{{ formatPaths(x.changedPaths) }}</pre>
        </div>
      </div>
    </details>
  </details>
</template>

<script setup>
import { computed, ref } from "vue";

const props = defineProps({
  runLog: { type: Array, required: true },
});

defineEmits(["clear"]);

const okFilter = ref("all");
const modeFilter = ref("all");
const q = ref("");

const modeOptions = computed(() => {
  const set = new Set();
  (Array.isArray(props.runLog) ? props.runLog : []).forEach((x) => set.add(String(x?.mode || "").trim()));
  return Array.from(set).filter(Boolean).sort();
});

function toSearchText(x) {
  const kinds = Array.isArray(x?.kinds) ? x.kinds.join(" ") : "";
  const paths = Array.isArray(x?.changedPaths) ? x.changedPaths.join("\n") : "";
  return [
    String(x?.at || ""),
    String(x?.mode || ""),
    String(x?.error || ""),
    String(x?.note || ""),
    String(x?.stepNameBefore || ""),
    String(x?.stepNameAfter || ""),
    kinds,
    paths,
  ]
    .join("\n")
    .toLowerCase();
}

const filtered = computed(() => {
  const list = Array.isArray(props.runLog) ? props.runLog : [];
  const query = String(q.value || "").trim().toLowerCase();
  return list
    .slice()
    .reverse()
    .filter((x) => {
      if (okFilter.value === "ok" && !x?.ok) return false;
      if (okFilter.value === "fail" && x?.ok) return false;
      if (modeFilter.value !== "all" && String(x?.mode || "") !== modeFilter.value) return false;
      if (query && !toSearchText(x).includes(query)) return false;
      return true;
    });
});

function stepText(x) {
  const before = x?.stepBefore ?? "—";
  const after = x?.stepAfter ?? "—";
  return `${before} -> ${after}`;
}

function summarizeText(text) {
  const s = String(text || "").trim();
  if (!s) return "";
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

function formatPaths(paths) {
  const list = Array.isArray(paths) ? paths : [];
  if (list.length === 0) return "（无）";
  const shown = list.slice(0, 50).map((p) => String(p || ""));
  const more = list.length > 50 ? `…（剩余 ${list.length - 50} 条）` : "";
  return [...shown, more].filter(Boolean).join("\n");
}
</script>
