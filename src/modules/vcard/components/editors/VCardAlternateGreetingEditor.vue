<!--
文件：VCardAlternateGreetingEditor.vue
模块：角色卡设计器
作用：alternate_greetings 单条编辑器（文件级）
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
          <textarea class="input vcardFileTextEditor__textarea" rows="10" :value="valueText" @change="onChange($event.target.value)"></textarea>
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
  index: { type: [Number, String], required: true },
});

const idx = computed(() => Number(props.index));
const list = computed(() => (Array.isArray(props.draft?.card?.alternate_greetings) ? props.draft.card.alternate_greetings : []));
const valueText = computed(() => {
  const i = idx.value;
  if (!Number.isFinite(i) || i < 0 || i >= list.value.length) return "";
  return String(list.value[i] ?? "");
});
const label = computed(() => `card.alternate_greetings[${Number.isFinite(idx.value) ? idx.value : "?"}]`);

function onChange(nextValue) {
  const i = idx.value;
  if (!Number.isFinite(i) || i < 0 || i >= list.value.length) return;
  props.applyItems([{ kind: "card.patch", patch: [{ op: "set", path: `card.alternate_greetings[${i}]`, value: String(nextValue ?? "") }] }]);
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
