<!--
文件：VCardPromptPackTemplatesEditor.vue
模块：角色卡设计器
作用：在 VCard 内管理 worldInfoBefore 的 PromptPack 模板列表（可导入 ctx.worldInfoBefore、排序、启用/禁用，并保存到服务端 settings 后随 turn/run 生效）
依赖：shared/apiV1/settings、defaultPromptPack.json
@created 2026-01-02
@modified 2026-01-14
-->

<template>
  <details class="vcardEditor">
    <summary class="vcardEditor__summary">PromptPack：worldInfoBefore 模板管理</summary>

    <div class="hint">按“模板顺序（从上到下）”拼接为一个注入块，保存到服务端 settings，随 VCard turn/run 生效。</div>

    <div class="formRow">
      <div class="formLabel">总开关</div>
      <div class="formCtrl">
        <label class="chk"><input type="checkbox" v-model="enabled" @change="saveEnabledOnly" /> enabled</label>
        <div class="hint">保存到服务端：/api/v1/settings（vcard.promptPack.enabled）</div>
      </div>
    </div>

    <details class="vcardEntry">
      <summary class="vcardEntry__title">当前注入预览（worldInfoBefore）</summary>
      <div class="hint" v-if="!enabled">提示：总开关关闭时不会注入；预览仍展示“文本内容”。</div>
      <div class="hint" v-if="dirty">提示：当前修改尚未保存；运行时仍使用“服务端已保存”的模板配置。</div>
      <div class="hint" v-if="!dirty && templates.length === 0">当前无模板：运行时不会注入额外提示。</div>
      <pre class="code" style="white-space: pre-wrap">{{ previewText || "（空）" }}</pre>
    </details>

    <div class="formRow">
      <div class="formLabel">模板列表</div>
      <div class="formCtrl">
        <div class="inline" style="flex-wrap: wrap; gap: 6px">
          <button class="btn" @click="addBlank">+ 空模板</button>
          <button class="btn" :disabled="!ctxWorldInfoBeforeTrimmed" @click="addFromCtxWorldInfoBefore">从 ctx.worldInfoBefore 导入</button>
          <select class="input input--sm" v-model="builtinId">
            <option value="">内置模板（可选）</option>
            <option v-for="t in builtins" :key="t.id" :value="t.id">{{ t.name }}</option>
          </select>
          <button class="btn" :disabled="!builtinId" @click="addFromBuiltin">添加内置模板</button>
          <button class="btn" @click="reload">重置</button>
          <button class="btn btn--primary" @click="saveAndApply">保存并应用</button>
          <button class="btn btn--danger" @click="resetToDefault">重置为默认</button>
        </div>
        <div class="hint">保存到服务端：/api/v1/settings（vcard.promptPack.templatesWorldInfoBefore）</div>
        <div class="hint">生效链路：服务端 turn/run 构建 ctx 时注入（不再使用 localStorage）。</div>
        <div class="hint" v-if="status">{{ status }}</div>
      </div>
    </div>

    <div class="hint" v-if="templates.length === 0">（暂无模板：可从内置模板添加，或从 ctx.worldInfoBefore 导入。）</div>

    <div v-for="(t, idx) in templates" :key="t.id" class="vcardEntry">
      <header class="vcardEntry__header">
        <div class="vcardEntry__title">#{{ idx + 1 }} {{ t.name || "（未命名）" }}</div>
        <div class="vcardEntry__actions">
          <button class="btn" :disabled="idx === 0" @click="moveTemplate(idx, -1)">上移</button>
          <button class="btn" :disabled="idx >= templates.length - 1" @click="moveTemplate(idx, 1)">下移</button>
          <button class="btn btn--danger" @click="removeTemplate(idx)">删除</button>
        </div>
      </header>

      <div class="vcardEntry__grid">
        <label class="chk"><input type="checkbox" :checked="Boolean(t.enabled)" @change="setTemplateField(idx, 'enabled', $event.target.checked)" /> enabled</label>
        <input class="input input--sm" :value="t.name || ''" @change="setTemplateField(idx, 'name', $event.target.value)" placeholder="name（可选）" />
        <div class="vcardEntry__row">
          <div class="k">content</div>
          <textarea class="input" rows="10" :value="t.content || ''" @change="setTemplateField(idx, 'content', $event.target.value)" placeholder="纯文本；建议短句；避免代码块…"></textarea>
        </div>
      </div>
    </div>
  </details>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { getApiV1Settings, patchApiV1Settings } from "../../../../shared";
import defaultPromptPack from "../../assets/promptPacks/defaultPromptPack.json";
import mvuVariablesTemplate from "../../assets/promptPacks/mvuVariablesTemplate.txt?raw";

const props = defineProps({
  ctx: { type: Object, required: true },
});

const enabled = ref(true);
const templates = ref([]);
const status = ref("");
const builtinId = ref("");
const dirty = ref(false);
const busy = ref(false);

const ctxWorldInfoBeforeTrimmed = computed(() => String(props.ctx?.worldInfoBefore || "").trim());

const builtins = computed(() => {
  const t0 = pickDefaultPromptPackWorldInfoBefore();
  return [
    { id: "t0_default_detailed", name: "默认示例模板（详细版）", content: t0 },
    { id: "t0_mvu_variables", name: "MVU 变量框架（test.txt）", content: pickMvuVariablesTemplateText() },
    { id: "t1_protocol_short", name: "协议兜底（短版）", content: builtinProtocolShort() },
    { id: "t2_regex_quickref", name: "Regex 速查（placement/语义）", content: builtinRegexQuickRef() },
  ].filter((x) => String(x.content || "").trim());
});

const previewText = computed(() => {
  const parts = (Array.isArray(templates.value) ? templates.value : [])
    .filter((t) => Boolean(t?.enabled))
    .map((t) => String(t?.content || "").trim())
    .filter(Boolean);
  return parts.join("\n\n").trim();
});

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function newId() {
  return `ui_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeTemplate(raw) {
  const obj = isPlainObject(raw) ? raw : {};
  const content = String(obj.content || "").replace(/\r\n/g, "\n");
  return {
    id: String(obj.id || "") || newId(),
    name: String(obj.name || ""),
    enabled: obj.enabled === undefined ? true : Boolean(obj.enabled),
    content,
  };
}

function normalizeTemplates(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list.map(normalizeTemplate);
}

async function load() {
  status.value = "";
  busy.value = true;
  try {
    const settings = await getApiV1Settings();
    const vcard = settings?.vcard && typeof settings.vcard === "object" ? settings.vcard : {};
    const pp = vcard?.promptPack && typeof vcard.promptPack === "object" ? vcard.promptPack : {};
    enabled.value = pp.enabled === undefined ? true : Boolean(pp.enabled);
    templates.value = normalizeTemplates(pp.templatesWorldInfoBefore);
  } catch (err) {
    status.value = `加载失败：${String(err?.message || err)}`;
    enabled.value = true;
    templates.value = [];
  } finally {
    busy.value = false;
  }
  dirty.value = false;
}

function pickDefaultPromptPackWorldInfoBefore() {
  const slots = Array.isArray(defaultPromptPack?.slots) ? defaultPromptPack.slots : [];
  const slot = slots.find((s) => String(s?.target || "") === "worldInfoBefore");
  return String(slot?.content || "").replace(/\r\n/g, "\n").trim();
}

function pickMvuVariablesTemplateText() {
  return String(mvuVariablesTemplate || "").replace(/\r\n/g, "\n").trim();
}

function builtinProtocolShort() {
  return [
    "【VCARD：协议兜底（短版）】",
    "",
    "1) 严格遵循【VCARD_CTRL】（它定义本轮允许修改范围与输出协议）。",
    "2) 只输出一个 <tool_use>...</tool_use>（块外禁止解释文字/额外标题）。",
    "3) 优先输出 *.patch（细粒度 set/remove），避免整包重写误伤。",
    "4) 不复述上下文；不要输出完整 CardDraft。",
  ].join("\n");
}

function builtinRegexQuickRef() {
  return [
    "【Regex 速查（SillyTavern 对齐）】",
    "",
    "- placement：1 USER_INPUT；2 AI_OUTPUT；3 SLASH_COMMAND；5 WORLD_INFO；6 REASONING；0 MD_DISPLAY（deprecated）。",
    "- options.substituteRegex：0 NONE；1 RAW；2 ESCAPED。",
    "- markdownOnly / promptOnly：都不勾=仅普通场景；都勾=仅 Markdown 或 Prompt 场景（不覆盖普通）。",
    "- options.minDepth / options.maxDepth：留空=不限制；maxDepth < minDepth 视为无效范围。",
  ].join("\n");
}

async function saveEnabledOnly() {
  if (busy.value) return;
  busy.value = true;
  status.value = "";
  try {
    const out = await patchApiV1Settings({ vcard: { promptPack: { enabled: Boolean(enabled.value) } } });
    const pp = out?.vcard?.promptPack && typeof out.vcard.promptPack === "object" ? out.vcard.promptPack : {};
    enabled.value = pp.enabled === undefined ? enabled.value : Boolean(pp.enabled);
    status.value = "已保存总开关：下次 turn/run 将生效。";
  } catch (err) {
    status.value = `保存失败：${String(err?.message || err)}`;
  } finally {
    busy.value = false;
  }
}

function confirmDanger({ opType, scope, risk }) {
  const confirmText = [
    "⚠️ 危险操作检测喵～",
    `操作类型：${String(opType || "")}`,
    `影响范围：${String(scope || "")}`,
    `风险评估：${String(risk || "")}`,
    "",
    "(有点紧张呢，请确认是否继续？)",
  ].join("\n");
  return typeof globalThis.confirm === "function" ? globalThis.confirm(confirmText) : true;
}

function addBlank() {
  templates.value = [...templates.value, { id: newId(), name: "新模板", enabled: true, content: "" }];
  dirty.value = true;
}

function addFromCtxWorldInfoBefore() {
  const content = ctxWorldInfoBeforeTrimmed.value;
  if (!content) return (status.value = "ctx.worldInfoBefore 为空，无法导入。");
  templates.value = [...templates.value, { id: newId(), name: "导入：ctx.worldInfoBefore", enabled: true, content }];
  dirty.value = true;
  status.value = "已加入列表（未保存）。";
}

function addFromBuiltin() {
  const picked = builtins.value.find((t) => String(t.id) === String(builtinId.value));
  if (!picked) return;
  templates.value = [...templates.value, { id: newId(), name: String(picked.name || ""), enabled: true, content: String(picked.content || "") }];
  builtinId.value = "";
  dirty.value = true;
  status.value = "已加入列表（未保存）。";
}

function moveTemplate(idx, delta) {
  const list = Array.isArray(templates.value) ? templates.value.slice() : [];
  const nextIdx = idx + delta;
  if (idx < 0 || idx >= list.length) return;
  if (nextIdx < 0 || nextIdx >= list.length) return;
  const item = list[idx];
  list.splice(idx, 1);
  list.splice(nextIdx, 0, item);
  templates.value = list;
  dirty.value = true;
}

function removeTemplate(idx) {
  const ok = confirmDanger({
    opType: "删除模板条目",
    scope: `模板列表第 ${Number(idx) + 1} 条`,
    risk: "删除后不可自动恢复（建议先复制备份）",
  });
  if (!ok) return;
  const list = Array.isArray(templates.value) ? templates.value.slice() : [];
  list.splice(idx, 1);
  templates.value = list;
  dirty.value = true;
}

function setTemplateField(idx, key, value) {
  const list = Array.isArray(templates.value) ? templates.value.slice() : [];
  const cur = list[idx] && typeof list[idx] === "object" ? list[idx] : {};
  list.splice(idx, 1, { ...cur, [key]: value });
  templates.value = list;
  dirty.value = true;
}

function reload() {
  load().then(() => (status.value = "已重置。"));
}

async function saveAndApply() {
  if (busy.value) return;
  const saved = normalizeTemplates(templates.value);
  const hasContent = saved.some((t) => Boolean(t.enabled) && String(t.content || "").trim());
  if (!hasContent) {
    const ok = confirmDanger({
      opType: "保存并应用（空注入块）",
      scope: "vcard.promptPack.templatesWorldInfoBefore（服务端 settings）",
      risk: "保存后不会注入任何模板内容（若你依赖该注入，请先添加内容或点“重载”检查）。",
    });
    if (!ok) return;
  }

  busy.value = true;
  status.value = "";
  try {
    const out = await patchApiV1Settings({
      vcard: {
        promptPack: {
          enabled: Boolean(enabled.value),
          templatesWorldInfoBefore: saved,
        },
      },
    });
    const pp = out?.vcard?.promptPack && typeof out.vcard.promptPack === "object" ? out.vcard.promptPack : {};
    enabled.value = pp.enabled === undefined ? enabled.value : Boolean(pp.enabled);
    templates.value = normalizeTemplates(pp.templatesWorldInfoBefore);
    dirty.value = false;
    status.value = "已保存并应用：下次 turn/run 将生效。";
  } catch (err) {
    status.value = `保存失败：${String(err?.message || err)}`;
  } finally {
    busy.value = false;
  }
}

async function resetToDefault() {
  if (busy.value) return;
  const ok = confirmDanger({
    opType: "清空模板列表",
    scope: "vcard.promptPack.templatesWorldInfoBefore（服务端 settings）",
    risk: "会丢失当前模板配置（建议先复制备份），并停止注入模板内容",
  });
  if (!ok) return;
  busy.value = true;
  status.value = "";
  try {
    const out = await patchApiV1Settings({
      vcard: {
        promptPack: {
          enabled: true,
          templatesWorldInfoBefore: [],
        },
      },
    });
    const pp = out?.vcard?.promptPack && typeof out.vcard.promptPack === "object" ? out.vcard.promptPack : {};
    enabled.value = pp.enabled === undefined ? true : Boolean(pp.enabled);
    templates.value = normalizeTemplates(pp.templatesWorldInfoBefore);
    dirty.value = false;
    status.value = "已重置为默认。";
  } catch (err) {
    status.value = `重置失败：${String(err?.message || err)}`;
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>
