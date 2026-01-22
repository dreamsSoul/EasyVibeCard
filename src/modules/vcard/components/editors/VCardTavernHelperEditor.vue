<!--
文件：VCardTavernHelperEditor.vue
模块：角色卡设计器
作用：Tavern Helper 脚本包管理（scripts + variables）
依赖：无
@created 2025-12-29
@modified 2025-12-29
-->

<template>
  <details class="vcardEditor">
    <summary class="vcardEditor__summary">Tavern Helper（脚本包）</summary>

    <div v-if="!draft" class="vcardEditor__empty">（草稿未就绪）</div>
    <template v-else>
      <div class="formRow">
        <div class="formLabel">脚本</div>
        <div class="formCtrl">
          <div class="inline">
            <button class="btn" @click="addScript">+ 新增脚本</button>
            <select class="input input--sm" v-model="tpl">
              <option value="">模板（可选）</option>
              <option value="scene_img">scene-img</option>
              <option value="statusbar">statusbar</option>
              <option value="time_location">time-location-widget</option>
            </select>
            <button class="btn" :disabled="!tpl" @click="addFromTemplate">套用模板</button>
          </div>
          <div class="hint">脚本内容允许 HTML/JS 注入；info 建议记录用途/约束/来源（可由用户或 AI 填写）。</div>
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
          <label class="chk"><input type="checkbox" :checked="Boolean(s.enabled)" @change="setScript(idx, { enabled: $event.target.checked })" /> enabled</label>
          <div class="inline">
            <input class="input input--sm" :value="s.name || ''" @change="setScript(idx, { name: $event.target.value })" placeholder="name" />
            <input class="input input--sm" :value="s.type || 'script'" @change="setScript(idx, { type: $event.target.value })" placeholder="type" title="type（默认 script）" />
          </div>
          <div class="vcardEntry__row">
            <div class="k">info</div>
            <textarea class="input" rows="2" :value="s.info || ''" @change="setScript(idx, { info: $event.target.value })"></textarea>
          </div>
          <div class="vcardEntry__row">
            <div class="k">content</div>
            <textarea class="input" rows="6" :value="s.content || ''" @change="setScript(idx, { content: $event.target.value })"></textarea>
          </div>
        </div>
      </div>

      <div class="formRow">
        <div class="formLabel">variables (JSON)</div>
        <div class="formCtrl">
          <textarea class="input" rows="6" :value="varsText" @change="onChangeVars($event.target.value)"></textarea>
          <div class="hint" v-if="varsError" style="color: var(--danger)">{{ varsError }}</div>
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
const varsError = ref("");

const scripts = computed(() => (Array.isArray(props.draft?.tavern_helper?.scripts) ? props.draft.tavern_helper.scripts : []));
const varsObj = computed(() => (props.draft?.tavern_helper?.variables && typeof props.draft.tavern_helper.variables === "object" ? props.draft.tavern_helper.variables : {}));
const varsText = computed(() => JSON.stringify(varsObj.value, null, 2));

function genId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `th_${Date.now()}_${Math.trunc(Math.random() * 100000)}`;
}

function write(nextScripts, nextVars) {
  props.applyItems([{ kind: "client_scripts.set", tavern_helper: { scripts: nextScripts, variables: nextVars } }]);
}

function addScript() {
  write([...scripts.value, { id: genId(), name: "", type: "script", info: "", enabled: true, content: "" }], varsObj.value);
}

function scriptTemplate(id) {
  if (id === "scene_img") {
    return {
      name: "scene-img",
      content: `// scene-img 模板：把 <scene="x.png"> 渲染为图片\n// （按需改成 Tavern Helper API 调用）\n`,
    };
  }
  if (id === "statusbar") {
    return { name: "statusbar", content: `// statusbar 模板：把 <StatusBlock>...</StatusBlock> 渲染为状态栏\n` };
  }
  if (id === "time_location") {
    return { name: "time-location-widget", content: `// time-location 模板：渲染 <time and location>[date][time][loc]</time and location>\n` };
  }
  return null;
}

function addFromTemplate() {
  const t = scriptTemplate(tpl.value);
  if (!t) return;
  write([...scripts.value, { id: genId(), enabled: true, type: "script", info: "", ...t }], varsObj.value);
  tpl.value = "";
}

function removeScript(idx) {
  const next = scripts.value.slice();
  next.splice(idx, 1);
  write(next, varsObj.value);
}

function setScript(idx, patch) {
  const next = scripts.value.slice();
  const cur = next[idx] || {};
  next.splice(idx, 1, { ...cur, ...patch });
  write(next, varsObj.value);
}

function onChangeVars(text) {
  varsError.value = "";
  try {
    const parsed = JSON.parse(String(text || ""));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("variables 必须是 JSON object。");
    write(scripts.value, parsed);
  } catch (err) {
    varsError.value = String(err?.message || err);
  }
}
</script>
