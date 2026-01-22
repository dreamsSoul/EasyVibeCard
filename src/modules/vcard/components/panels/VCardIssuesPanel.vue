<!--
文件：VCardIssuesPanel.vue
模块：角色卡设计器
作用：聚合展示校验问题（errors / warnings）
依赖：无
@created 2025-12-31
@modified 2025-12-31
-->

<template>
  <div>
    <div v-if="!draft" class="vcardEditor__empty">（草稿未就绪）</div>

    <template v-else>
      <details class="vcardEditor" open>
        <summary class="vcardEditor__summary">Errors（{{ errors.length }}）</summary>
        <div v-if="errors.length === 0" class="vcardEditor__empty">（暂无）</div>
        <ul v-else class="vcardIssues__list">
          <li v-for="(e, idx) in errors" :key="idx">{{ e }}</li>
        </ul>
      </details>

      <details class="vcardEditor" style="margin-top: 10px" :open="warnings.length > 0">
        <summary class="vcardEditor__summary">Warnings（{{ warnings.length }}）</summary>
        <div v-if="warnings.length === 0" class="vcardEditor__empty">（暂无）</div>
        <ul v-else class="vcardIssues__list">
          <li v-for="(w, idx) in warnings" :key="idx">{{ w }}</li>
        </ul>
      </details>
    </template>
  </div>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  draft: { type: Object, default: null },
});

const errors = computed(() => (Array.isArray(props.draft?.validation?.errors) ? props.draft.validation.errors : []));
const warnings = computed(() => (Array.isArray(props.draft?.validation?.warnings) ? props.draft.validation.warnings : []));
</script>

<style scoped>
.vcardIssues__list {
  margin: 10px 0 0;
  padding-left: 18px;
  color: var(--text);
  font-size: 12px;
  line-height: 1.5;
}
</style>

