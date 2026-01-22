<!--
文件：VCardRegexScriptsEditor.vue
模块：角色卡设计器
作用：Regex Scripts 编辑器（对齐 ST：placement/markdownOnly/promptOnly/min/maxDepth/runOnEdit/substituteRegex/trimStrings）
依赖：无
@created 2025-12-29
@modified 2026-01-02
-->

<template>
  <details class="vcardEditor">
    <summary class="vcardEditor__summary">Regex Scripts（渲染/清洗）</summary>

    <div v-if="!draft" class="vcardEditor__empty">（草稿未就绪）</div>
    <template v-else>
      <div class="formRow">
        <div class="formLabel">脚本</div>
        <div class="formCtrl">
          <div class="inline">
            <button class="btn" @click="addScript">+ 新增脚本</button>
            <select class="input input--sm" v-model="tpl">
              <option value="">模板（可选）</option>
              <option value="scene_img">Scene 图片标签</option>
              <option value="strip_details">清理 details</option>
              <option value="strip_statusblock">清理 StatusBlock</option>
            </select>
            <button class="btn" :disabled="!tpl" @click="addFromTemplate">套用模板</button>
          </div>
          <div class="hint">
            字段对齐 ST：作用方位=placement；仅显示=markdownOnly；仅提示词=promptOnly；深度=min/maxDepth；编辑旧消息=runOnEdit；替换宏=substituteRegex；剪裁=trimStrings。
          </div>
        </div>
      </div>

      <div v-for="(s, idx) in scripts" :key="idx" class="vcardEntry">
        <header class="vcardEntry__header">
          <div class="vcardEntry__title">#{{ idx + 1 }} {{ s.name || s.id || "（未命名）" }}</div>
          <div class="vcardEntry__actions">
            <button class="btn btn--danger" @click="removeScript(idx)">删除</button>
          </div>
        </header>

        <div class="vcardEntry__grid">
          <label class="chk"><input type="checkbox" :checked="Boolean(s.enabled)" @change="setField(idx, 'enabled', $event.target.checked)" /> enabled</label>

          <div class="inline">
            <input class="input input--sm" :value="s.name || ''" @change="setField(idx, 'name', $event.target.value)" placeholder="name" />
            <label class="chk"><input type="checkbox" :checked="Boolean(s.markdownOnly)" @change="setField(idx, 'markdownOnly', $event.target.checked)" /> 仅显示</label>
            <label class="chk"><input type="checkbox" :checked="Boolean(s.promptOnly)" @change="setField(idx, 'promptOnly', $event.target.checked)" /> 仅提示词</label>
            <label class="chk"><input type="checkbox" :checked="Boolean(s.options?.runOnEdit)" @change="setOptionsField(idx, 'runOnEdit', $event.target.checked)" /> runOnEdit</label>
            <select class="input input--sm" :value="String(s.options?.substituteRegex ?? 0)" @change="setOptionsField(idx, 'substituteRegex', Number($event.target.value))">
              <option v-for="o in substituteRegexOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </div>

          <div class="vcardEntry__row">
            <div class="k">placement（作用方位）</div>
            <div class="inline" style="flex-wrap: wrap">
              <label v-for="p in placementOptions" :key="p.value" class="chk" :title="p.deprecated ? 'deprecated' : ''">
                <input type="checkbox" :checked="hasPlacement(s, p.value)" @change="togglePlacement(idx, p.value, $event.target.checked)" />
                {{ p.label }}
              </label>
            </div>
          </div>

          <div class="inline">
            <input
              class="input input--sm"
              type="number"
              :value="s.options?.minDepth ?? ''"
              @change="setOptionsField(idx, 'minDepth', parseIntOrNull($event.target.value))"
              placeholder="minDepth"
              title="minDepth（深度下限；允许 -1）"
            />
            <input
              class="input input--sm"
              type="number"
              :value="s.options?.maxDepth ?? ''"
              @change="setOptionsField(idx, 'maxDepth', parseIntOrNull($event.target.value))"
              placeholder="maxDepth"
              title="maxDepth（深度上限；留空表示不限制）"
            />
          </div>

          <div class="inline">
            <select class="input input--sm" :value="s.find?.style || 'raw'" @change="setFind(idx, 'style', $event.target.value)">
              <option value="raw">raw</option>
              <option value="slash">slash</option>
            </select>
            <input class="input" :value="s.find?.pattern || ''" @change="setFind(idx, 'pattern', $event.target.value)" placeholder="pattern 或 /pattern/flags" />
            <input class="input input--sm" :value="s.find?.flags || ''" @change="setFind(idx, 'flags', $event.target.value)" placeholder="flags" />
          </div>

          <div class="vcardEntry__row">
            <div class="k">replace</div>
            <textarea class="input" rows="3" :value="s.replace || ''" @change="setField(idx, 'replace', $event.target.value)"></textarea>
          </div>

          <div class="vcardEntry__row">
            <div class="k">trimStrings（按行/逗号分隔）</div>
            <textarea class="input" rows="2" :value="fmtTrimStrings(s.trimStrings)" @change="setField(idx, 'trimStrings', parseStringList($event.target.value))"></textarea>
          </div>
        </div>
      </div>
    </template>
  </details>
</template>

<script setup>
import { computed, ref } from "vue";

const props = defineProps({
  draft: { type: Object, default: null },
  applyItems: { type: Function, required: true },
});

const tpl = ref("");
const scripts = computed(() => (Array.isArray(props.draft?.regex_scripts) ? props.draft.regex_scripts : []));

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

function genId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `rs_${Date.now()}_${Math.trunc(Math.random() * 100000)}`;
}

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

function addScript() {
  write([
    ...scripts.value,
    {
      id: genId(),
      name: "",
      enabled: true,
      placement: [],
      markdownOnly: false,
      promptOnly: false,
      find: { pattern: "", flags: "g", style: "raw" },
      replace: "",
      trimStrings: [],
      options: { runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null },
    },
  ]);
}

function scriptTemplate(id) {
  if (id === "scene_img") {
    return {
      name: "Scene 图片标签",
      enabled: true,
      placement: [],
      markdownOnly: true,
      promptOnly: false,
      find: { pattern: '<scene="([^"]+)">', flags: "g", style: "raw" },
      replace: '<img class="scene" src="$1" />',
      trimStrings: [],
      options: { runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null },
    };
  }
  if (id === "strip_details") {
    return {
      name: "清理 details",
      enabled: true,
      placement: [],
      markdownOnly: false,
      promptOnly: true,
      find: { pattern: "<details>[\\s\\S]*?<\\/details>", flags: "g", style: "raw" },
      replace: "",
      trimStrings: [],
      options: { runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null },
    };
  }
  if (id === "strip_statusblock") {
    return {
      name: "清理 StatusBlock",
      enabled: true,
      placement: [],
      markdownOnly: false,
      promptOnly: true,
      find: { pattern: "<StatusBlock>[\\s\\S]*?<\\/StatusBlock>", flags: "g", style: "raw" },
      replace: "",
      trimStrings: [],
      options: { runOnEdit: false, substituteRegex: 0, minDepth: null, maxDepth: null },
    };
  }
  return null;
}

function addFromTemplate() {
  const t = scriptTemplate(tpl.value);
  if (!t) return;
  write([...scripts.value, { id: genId(), ...t }]);
  tpl.value = "";
}

function removeScript(idx) {
  const next = scripts.value.slice();
  next.splice(idx, 1);
  write(next);
}

function setField(idx, key, value) {
  const next = scripts.value.slice();
  const cur = next[idx] || {};
  next.splice(idx, 1, { ...cur, [key]: value });
  write(next);
}

function setFind(idx, key, value) {
  const next = scripts.value.slice();
  const cur = next[idx] || {};
  const find = cur.find || {};
  next.splice(idx, 1, { ...cur, find: { ...find, [key]: value } });
  write(next);
}

function setOptionsField(idx, key, value) {
  const next = scripts.value.slice();
  const cur = next[idx] || {};
  const baseOpt = cur.options && typeof cur.options === "object" && !Array.isArray(cur.options) ? cur.options : {};
  next.splice(idx, 1, { ...cur, options: { ...baseOpt, [key]: value } });
  write(next);
}

function hasPlacement(script, value) {
  const list = Array.isArray(script?.placement) ? script.placement : [];
  return list.includes(Number(value));
}

function togglePlacement(idx, value, checked) {
  const next = scripts.value.slice();
  const cur = next[idx] || {};
  const list = Array.isArray(cur.placement) ? cur.placement.slice() : [];
  const v = Number(value);
  if (!Number.isFinite(v)) return;
  const i = list.indexOf(v);
  if (checked && i === -1) list.push(v);
  if (!checked && i !== -1) list.splice(i, 1);
  list.sort((a, b) => a - b);
  next.splice(idx, 1, { ...cur, placement: list });
  write(next);
}

function fmtTrimStrings(list) {
  const arr = Array.isArray(list) ? list : [];
  return arr.join("\n");
}

function parseStringList(text) {
  return String(text || "")
    .split(/,|\n/g)
    .map((x) => x.trim())
    .filter(Boolean);
}
</script>
