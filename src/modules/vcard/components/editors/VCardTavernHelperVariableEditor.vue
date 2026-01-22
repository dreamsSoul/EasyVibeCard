<!--
文件：VCardTavernHelperVariableEditor.vue
模块：角色卡设计器
作用：Tavern Helper variables 单条编辑器（支持字符串直编，其它类型 JSON）
依赖：无
@created 2026-01-20
@modified 2026-01-20
-->

<template>
  <div class="vcardThVarEditor">
    <div v-if="!draft" class="vcardEditor__empty">（草稿未就绪）</div>
    <div v-else-if="!hasVar" class="error">（tavern_helper.variables 不存在：{{ varKey }}）</div>
    <template v-else>
      <div class="formRow">
        <div class="formLabel">{{ label }}</div>
        <div class="formCtrl">
          <textarea
            v-if="isString"
            class="input vcardThVarEditor__textarea"
            rows="8"
            :value="String(varValue ?? '')"
            @change="setString($event.target.value)"
          ></textarea>
          <textarea
            v-else
            class="input vcardThVarEditor__textarea"
            rows="10"
            :value="jsonText"
            @change="setJson($event.target.value)"
          ></textarea>
          <div class="hint" v-if="!isString">非字符串类型按 JSON 编辑（例如：true / 123 / {\"a\":1}）。</div>
          <div class="hint" v-else>字符串类型可直接编辑。</div>
          <div class="hint" v-if="parseError" style="color: var(--danger)">{{ parseError }}</div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, ref, watch } from "vue";

const props = defineProps({
  draft: { type: Object, default: null },
  applyItems: { type: Function, required: true },
  varKey: { type: String, required: true },
});

const scripts = computed(() => (Array.isArray(props.draft?.tavern_helper?.scripts) ? props.draft.tavern_helper.scripts : []));
const varsObj = computed(() => (props.draft?.tavern_helper?.variables && typeof props.draft.tavern_helper.variables === "object" ? props.draft.tavern_helper.variables : {}));
const key = computed(() => String(props.varKey || ""));
const hasVar = computed(() => key.value && key.value in varsObj.value);
const varValue = computed(() => (hasVar.value ? varsObj.value[key.value] : null));
const isString = computed(() => typeof varValue.value === "string");
const label = computed(() => `tavern_helper.variables.${key.value || "?"}`);

const parseError = ref("");
const jsonText = computed(() => {
  try {
    return JSON.stringify(varValue.value ?? null, null, 2);
  } catch {
    return "null";
  }
});

watch(
  () => key.value,
  () => {
    parseError.value = "";
  },
);

function write(nextVars) {
  props.applyItems([{ kind: "client_scripts.set", tavern_helper: { scripts: scripts.value, variables: nextVars } }]);
}

function setString(nextValue) {
  if (!hasVar.value) return;
  parseError.value = "";
  const next = { ...varsObj.value, [key.value]: String(nextValue ?? "") };
  write(next);
}

function setJson(text) {
  if (!hasVar.value) return;
  parseError.value = "";
  try {
    const parsed = JSON.parse(String(text || ""));
    const next = { ...varsObj.value, [key.value]: parsed };
    write(next);
  } catch (err) {
    parseError.value = String(err?.message || err);
  }
}
</script>

<style scoped>
.vcardThVarEditor__textarea {
  resize: vertical;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 12px;
  line-height: 1.55;
}
</style>

