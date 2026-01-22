<!--
文件：VCardCardTextEditor.vue
模块：角色卡设计器
作用：Card 文本字段编辑器（单文件：content + 统计）
依赖：无
@created 2026-01-20
@modified 2026-01-20
-->

<template>
  <div class="vcardFileTextEditor">
    <div v-if="!draft" class="vcardEditor__empty">（草稿未就绪）</div>
    <template v-else>
      <div class="formRow">
        <div class="formLabel">{{ label }}</div>
        <div class="formCtrl">
          <textarea class="input vcardFileTextEditor__textarea" :rows="rows" :value="valueText" @change="onChange($event.target.value)"></textarea>
          <div class="hint">长度：{{ valueText.length }}</div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  draft: { type: Object, default: null },
  applyItems: { type: Function, required: true },
  fieldKey: { type: String, required: true },
  rows: { type: [Number, String], default: 16 },
});

const field = computed(() => String(props.fieldKey || "").trim());
const label = computed(() => `card.${field.value}`);
const valueText = computed(() => String(props.draft?.card?.[field.value] ?? ""));

function onChange(nextValue) {
  const key = field.value;
  if (!key) return;
  props.applyItems([{ kind: "card.patch", patch: [{ op: "set", path: `card.${key}`, value: String(nextValue ?? "") }] }]);
}
</script>

<style scoped>
.vcardFileTextEditor__textarea {
  resize: vertical;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 12px;
  line-height: 1.55;
}
</style>

