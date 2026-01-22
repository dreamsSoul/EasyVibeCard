<!--
文件：VCardTavernHelperScriptEntryEditor.vue
模块：角色卡设计器
作用：Tavern Helper scripts 单条编辑器（内容在上，元属性在下）
依赖：无
@created 2026-01-20
@modified 2026-01-20
-->

<template>
  <div class="vcardThScriptEditor">
    <div v-if="!draft" class="vcardEditor__empty">（草稿未就绪）</div>
    <div v-else-if="!script" class="error">（tavern_helper.scripts 条目不存在：index={{ index }}）</div>
    <template v-else>
      <div class="formRow">
        <div class="formLabel">content</div>
        <div class="formCtrl">
          <textarea class="input vcardThScriptEditor__content" rows="12" :value="String(script.content || '')" @change="setField('content', $event.target.value)"></textarea>
          <div class="hint">长度：{{ String(script.content || "").length }}</div>
        </div>
      </div>

      <details class="vcardEditor">
        <summary class="vcardEditor__summary">元属性</summary>

        <div class="formRow">
          <div class="formLabel">enabled</div>
          <div class="formCtrl">
            <label class="chk"><input type="checkbox" :checked="Boolean(script.enabled)" @change="setField('enabled', $event.target.checked)" /> enabled</label>
          </div>
        </div>

        <div class="formRow">
          <div class="formLabel">name / type</div>
          <div class="formCtrl">
            <div class="inline">
              <input class="input input--sm" :value="String(script.name || '')" @change="setField('name', $event.target.value)" placeholder="name" />
              <input class="input input--sm" :value="String(script.type || 'script')" @change="setField('type', $event.target.value)" placeholder="type" title="type（默认 script）" />
            </div>
            <div class="hint">name 会影响文件名显示（用于文件树路径）。</div>
          </div>
        </div>

        <div class="formRow">
          <div class="formLabel">info</div>
          <div class="formCtrl">
            <textarea class="input vcardThScriptEditor__info" rows="3" :value="String(script.info || '')" @change="setField('info', $event.target.value)"></textarea>
          </div>
        </div>
      </details>
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
const scripts = computed(() => (Array.isArray(props.draft?.tavern_helper?.scripts) ? props.draft.tavern_helper.scripts : []));
const varsObj = computed(() => (props.draft?.tavern_helper?.variables && typeof props.draft.tavern_helper.variables === "object" ? props.draft.tavern_helper.variables : {}));
const script = computed(() => {
  const i = idx.value;
  if (!Number.isFinite(i) || i < 0 || i >= scripts.value.length) return null;
  return scripts.value[i] || null;
});

function write(nextScripts, nextVars) {
  props.applyItems([{ kind: "client_scripts.set", tavern_helper: { scripts: nextScripts, variables: nextVars } }]);
}

function setField(field, value) {
  const i = idx.value;
  if (!Number.isFinite(i) || i < 0) return;
  const next = scripts.value.slice();
  const cur = next[i] || {};
  next.splice(i, 1, { ...cur, [String(field)]: value });
  write(next, varsObj.value);
}
</script>

<style scoped>
.vcardThScriptEditor__content,
.vcardThScriptEditor__info {
  resize: vertical;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 12px;
  line-height: 1.55;
}
</style>

