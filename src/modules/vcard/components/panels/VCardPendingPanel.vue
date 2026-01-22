<!--
文件：VCardPendingPanel.vue
模块：角色卡设计器
作用：待审批项面板（plan_review / patch_review：Approve/Reject/Accept/Reject/Ask）
依赖：无
@created 2026-01-17
@modified 2026-01-17
-->

<template>
  <div v-if="kind" class="vcardPending">
    <div class="vcardPending__head">
      <div class="vcardPending__title">{{ titleText }}</div>
      <div class="vcardPending__meta">
        <span class="mono" v-if="createdAtText">at={{ createdAtText }}</span>
        <span class="mono">base={{ baseVersion }}</span>
      </div>
    </div>

    <div v-if="kind === 'plan_review'" class="vcardPending__body">
      <div class="vcardPending__row" v-if="goalText"><span class="k">目标</span><span class="v">{{ goalText }}</span></div>
      <div class="vcardPending__row"><span class="k">任务</span><span class="v">{{ tasks.length }}</span></div>
      <ul v-if="tasks.length" class="vcardPending__list">
        <li v-for="t in tasks.slice(0, 10)" :key="t.id">
          <span class="tag">{{ t.status }}</span>
          <span class="mono">{{ t.id }}</span>
          <span>{{ t.title }}</span>
        </li>
      </ul>
      <div v-if="tasks.length > 10" class="muted">仅展示前 10 条。</div>
      <details v-if="warnings.length" class="vcardPending__details" open>
        <summary>Warnings（{{ warnings.length }}）</summary>
        <ul class="vcardPending__warnings">
          <li v-for="(w, idx) in warnings" :key="idx">{{ w }}</li>
        </ul>
      </details>
    </div>

    <div v-else-if="kind === 'patch_review'" class="vcardPending__body">
      <div class="vcardPending__row" v-if="kinds.length"><span class="k">kinds</span><span class="v mono">{{ kinds.join(' / ') }}</span></div>
      <div class="vcardPending__row"><span class="k">changedPaths</span><span class="v">{{ changedPaths.length }}</span></div>

      <div v-if="preview?.worldbookName" class="vcardPending__row">
        <span class="k">世界书名</span>
        <span class="v">{{ preview.worldbookName.before || "（空）" }} → {{ preview.worldbookName.after || "（空）" }}</span>
      </div>

      <details v-if="entryDiffs.length" class="vcardPending__details" open>
        <summary>世界书变更（{{ entryDiffs.length }}）</summary>
        <div v-for="d in entryDiffs" :key="d.idx" class="vcardPending__diff">
          <div class="vcardPending__diffHead">
            <span class="mono">#{{ Number(d.idx) + 1 }}</span>
            <span>{{ d.title }}</span>
            <span v-if="d.fields?.length" class="muted">fields: {{ d.fields.join(", ") }}</span>
          </div>
          <div class="vcardPending__diffGrid">
            <div class="muted">Before</div>
            <div class="muted">After</div>
            <pre class="code vcardPending__code">{{ d.beforeText }}</pre>
            <pre class="code vcardPending__code">{{ d.afterText }}</pre>
          </div>
        </div>
      </details>

      <details v-if="changedPaths.length" class="vcardPending__details">
        <summary>changedPaths（{{ changedPaths.length }}）</summary>
        <pre class="code vcardPending__code">{{ changedPaths.join("\n") }}</pre>
      </details>
    </div>

    <div class="vcardPending__actions">
      <button v-if="kind === 'plan_review'" class="btn btn--primary" :disabled="busy" @click="$emit('approvePlan')">批准</button>
      <button v-if="kind === 'plan_review'" class="btn" :disabled="busy" @click="$emit('rejectPlan')">驳回</button>

      <button v-if="kind === 'patch_review'" class="btn btn--primary" :disabled="busy" @click="$emit('acceptPatch')">Accept</button>
      <button v-if="kind === 'patch_review'" class="btn" :disabled="busy" @click="$emit('rejectPatch')">Reject</button>

      <button class="btn" :disabled="busy" @click="onAskClick">追问</button>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  pending: { type: Object, default: null },
  busy: { type: Boolean, default: false },
});

const emit = defineEmits(["approvePlan", "rejectPlan", "acceptPatch", "rejectPatch", "ask"]);

const kind = computed(() => String(props.pending?.kind || "").trim());
const baseVersion = computed(() => Number(props.pending?.baseVersion) || 0);

const createdAtText = computed(() => {
  const p = props.pending || {};
  const inner = kind.value === "plan_review" ? p.pendingPlan : kind.value === "patch_review" ? p.pendingReview : null;
  return String(inner?.createdAt || p.createdAt || "").trim();
});

const titleText = computed(() => {
  if (kind.value === "plan_review") return "待审批计划（plan_review）";
  if (kind.value === "patch_review") return "待确认变更（patch_review）";
  return "";
});

const goalText = computed(() => String(props.pending?.pendingPlan?.plan?.goal || "").trim());
const tasks = computed(() => (Array.isArray(props.pending?.pendingPlan?.plan?.tasks) ? props.pending.pendingPlan.plan.tasks : []));
const warnings = computed(() => (Array.isArray(props.pending?.pendingPlan?.warnings) ? props.pending.pendingPlan.warnings : []));

const kinds = computed(() => (Array.isArray(props.pending?.pendingReview?.kinds) ? props.pending.pendingReview.kinds : []));
const changedPaths = computed(() => (Array.isArray(props.pending?.pendingReview?.changedPaths) ? props.pending.pendingReview.changedPaths : []));
const preview = computed(() => (props.pending?.pendingReview?.preview && typeof props.pending.pendingReview.preview === "object" ? props.pending.pendingReview.preview : null));
const entryDiffs = computed(() => (Array.isArray(preview.value?.worldbookEntryDiffs) ? preview.value.worldbookEntryDiffs : []));

function onAskClick() {
  const text = String(prompt("请输入追问（会清理当前 pending 并重新触发一次 turn）：", "") || "").trim();
  if (!text) return;
  emit("ask", { askText: text });
}
</script>

<style scoped>
.vcardPending {
  margin: 10px 0 12px;
  padding: 10px 12px;
  border: 1px solid rgba(120, 120, 150, 0.25);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
}

.vcardPending__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.vcardPending__title {
  font-weight: 700;
}

.vcardPending__meta {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.vcardPending__row {
  display: flex;
  gap: 8px;
  margin: 6px 0;
}

.vcardPending__row .k {
  width: 90px;
  color: var(--text-secondary, #bbb);
}

.vcardPending__row .v {
  flex: 1;
  min-width: 0;
}

.vcardPending__list {
  margin: 8px 0;
  padding-left: 18px;
}

.vcardPending__warnings {
  margin: 8px 0 0;
  padding-left: 18px;
}

.vcardPending__actions {
  margin-top: 10px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.vcardPending__details {
  margin-top: 8px;
}

.vcardPending__diff {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(120, 120, 150, 0.2);
}

.vcardPending__diffHead {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.vcardPending__diffGrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 10px;
  margin-top: 8px;
}

.vcardPending__code {
  max-height: 220px;
  overflow: auto;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 12px;
}

.muted {
  color: var(--text-secondary, #888);
}

.tag {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  background: rgba(120, 120, 150, 0.18);
  margin-right: 6px;
  font-size: 12px;
}
</style>

