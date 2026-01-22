<!--
文件：VCardRegexScriptEntryEditor.vue
模块：角色卡设计器
作用：Regex Script 单条编辑器（内容在上，元属性在下）
依赖：无
@created 2026-01-20
@modified 2026-01-20
-->

<template>
  <div class="vcardRegexScriptEntryEditor">
    <div v-if="!draft" class="vcardEditor__empty">（草稿未就绪）</div>
    <div v-else-if="!script" class="error">（regex_scripts 条目不存在：index={{ index }}）</div>
    <template v-else>
      <div class="formRow">
        <div class="formLabel">find</div>
        <div class="formCtrl">
          <div class="inline">
            <select class="input input--sm" :value="String(script.find?.style || 'raw')" @change="setFind('style', $event.target.value)">
              <option value="raw">raw</option>
              <option value="slash">slash</option>
            </select>
            <input class="input" :value="String(script.find?.pattern || '')" @change="setFind('pattern', $event.target.value)" placeholder="pattern 或 /pattern/flags" />
            <input class="input input--sm" :value="String(script.find?.flags || '')" @change="setFind('flags', $event.target.value)" placeholder="flags" />
          </div>
          <div class="hint">style=raw：pattern 为正则正文，flags 单独填；style=slash：pattern 形如 /.../gimsuy。</div>
        </div>
      </div>

      <div class="formRow">
        <div class="formLabel">replace</div>
        <div class="formCtrl">
          <textarea class="input vcardRegexScriptEntryEditor__textarea" rows="6" :value="String(script.replace || '')" @change="setField('replace', $event.target.value)"></textarea>
        </div>
      </div>

      <details class="vcardEditor">
        <summary class="vcardEditor__summary">元属性</summary>

        <div class="formRow">
          <div class="formLabel">name</div>
          <div class="formCtrl">
            <input class="input" :value="String(script.name || '')" @change="setField('name', $event.target.value)" />
            <div class="hint">name 会影响文件名显示（用于文件树路径）。</div>
          </div>
        </div>

        <div class="formRow">
          <div class="formLabel">enabled / scope</div>
          <div class="formCtrl">
            <div class="inline">
              <label class="chk"><input type="checkbox" :checked="Boolean(script.enabled)" @change="setField('enabled', $event.target.checked)" /> enabled</label>
              <label class="chk"><input type="checkbox" :checked="Boolean(script.markdownOnly)" @change="setField('markdownOnly', $event.target.checked)" /> markdownOnly（仅显示）</label>
              <label class="chk"><input type="checkbox" :checked="Boolean(script.promptOnly)" @change="setField('promptOnly', $event.target.checked)" /> promptOnly（仅提示词）</label>
              <label class="chk"><input type="checkbox" :checked="Boolean(script.options?.runOnEdit)" @change="setOptionsField('runOnEdit', $event.target.checked)" /> runOnEdit</label>
            </div>
          </div>
        </div>

        <div class="formRow">
          <div class="formLabel">placement</div>
          <div class="formCtrl">
            <div class="inline" style="flex-wrap: wrap">
              <label v-for="p in placementOptions" :key="p.value" class="chk" :title="p.deprecated ? 'deprecated' : ''">
                <input type="checkbox" :checked="hasPlacement(p.value)" @change="togglePlacement(p.value, $event.target.checked)" />
                {{ p.label }}
              </label>
            </div>
            <div class="hint">placement 为空 = 不运行；常用：USER_INPUT / AI_OUTPUT。</div>
          </div>
        </div>

        <div class="formRow">
          <div class="formLabel">options</div>
          <div class="formCtrl">
            <div class="inline">
              <select class="input input--sm" :value="String(script.options?.substituteRegex ?? 0)" @change="setOptionsField('substituteRegex', Number($event.target.value))">
                <option v-for="o in substituteRegexOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
              <input
                class="input input--sm"
                type="number"
                :value="script.options?.minDepth ?? ''"
                @change="setOptionsField('minDepth', parseIntOrNull($event.target.value))"
                placeholder="minDepth"
                title="minDepth（深度下限；允许 -1）"
              />
              <input
                class="input input--sm"
                type="number"
                :value="script.options?.maxDepth ?? ''"
                @change="setOptionsField('maxDepth', parseIntOrNull($event.target.value))"
                placeholder="maxDepth"
                title="maxDepth（深度上限；留空表示不限制）"
              />
            </div>
          </div>
        </div>

        <div class="formRow">
          <div class="formLabel">trimStrings</div>
          <div class="formCtrl">
            <textarea class="input vcardRegexScriptEntryEditor__textarea" rows="4" :value="fmtTrimStrings(script.trimStrings)" @change="setField('trimStrings', parseStringList($event.target.value))"></textarea>
            <div class="hint">按行/逗号分隔。</div>
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

const placementOptions = Object.freeze([
  { value: 1, label: "USER_INPUT（用户输入）" },
  { value: 2, label: "AI_OUTPUT（AI 输出）" },
  { value: 3, label: "SLASH_COMMAND（/ 命令）" },
  { value: 5, label: "WORLD_INFO（世界书注入）" },
  { value: 6, label: "REASONING（推理）" },
  { value: 0, label: "MD_DISPLAY（已废弃）", deprecated: true },
]);

const substituteRegexOptions = Object.freeze([
  { value: 0, label: "substituteRegex=0（NONE）" },
  { value: 1, label: "substituteRegex=1（RAW）" },
  { value: 2, label: "substituteRegex=2（ESCAPED）" },
]);

const idx = computed(() => Number(props.index));
const scripts = computed(() => (Array.isArray(props.draft?.regex_scripts) ? props.draft.regex_scripts : []));
const script = computed(() => {
  const i = idx.value;
  if (!Number.isFinite(i) || i < 0 || i >= scripts.value.length) return null;
  return scripts.value[i] || null;
});

function parseIntOrNull(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function write(next) {
  props.applyItems([{ kind: "regex_scripts.set", regex_scripts: next }]);
}

function setScript(patch) {
  const i = idx.value;
  if (!Number.isFinite(i) || i < 0) return;
  const next = scripts.value.slice();
  const cur = next[i] || {};
  next.splice(i, 1, { ...cur, ...patch });
  write(next);
}

function setField(key, value) {
  setScript({ [String(key)]: value });
}

function setFind(key, value) {
  const cur = script.value || {};
  const find = cur.find || {};
  setScript({ find: { ...find, [String(key)]: value } });
}

function setOptionsField(key, value) {
  const cur = script.value || {};
  const baseOpt = cur.options && typeof cur.options === "object" && !Array.isArray(cur.options) ? cur.options : {};
  setScript({ options: { ...baseOpt, [String(key)]: value } });
}

function hasPlacement(value) {
  const list = Array.isArray(script.value?.placement) ? script.value.placement : [];
  return list.includes(Number(value));
}

function togglePlacement(value, checked) {
  const cur = script.value || {};
  const list = Array.isArray(cur.placement) ? cur.placement.slice() : [];
  const v = Number(value);
  if (!Number.isFinite(v)) return;
  const i = list.indexOf(v);
  if (checked && i === -1) list.push(v);
  if (!checked && i !== -1) list.splice(i, 1);
  list.sort((a, b) => a - b);
  setScript({ placement: list });
}

function fmtTrimStrings(list) {
  return (Array.isArray(list) ? list : []).join("\\n");
}

function parseStringList(text) {
  return String(text || "")
    .split(/,|\\n/g)
    .map((x) => x.trim())
    .filter(Boolean);
}
</script>

<style scoped>
.vcardRegexScriptEntryEditor__textarea {
  resize: vertical;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 12px;
  line-height: 1.55;
}
</style>

