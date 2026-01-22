<!--
文件：VCardOutputCleanerEditor.vue
模块：角色卡设计器
作用：配置“上下文输出清洗”（去思考过程）；保存到服务端 settings，随 VCard turn/run 生效
依赖：shared/apiV1/settings、vcard/domain/outputCleaner
@created 2026-01-02
@modified 2026-01-20
-->

<template>
  <details class="vcardEditor">
    <summary class="vcardEditor__summary">上下文输出清洗（去思考过程）</summary>

    <div class="hint">用于控制上下文清洗与显示口径：enabled 决定是否清洗；writeBack 决定是否落库写回。</div>

    <div class="formRow">
      <div class="formLabel">总开关</div>
      <div class="formCtrl">
        <label class="chk"><input type="checkbox" v-model="enabled" /> enabled</label>
        <label class="chk"><input type="checkbox" v-model="writeBack" /> 写回聊天记录原文（落库）</label>
        <div class="hint">保存到服务端：/api/v1/settings（vcard.outputCleaner.config.enabled / vcard.outputCleaner.writeBack）</div>
      </div>
    </div>

    <div class="formRow">
      <div class="formLabel">规则</div>
      <div class="formCtrl">
        <div class="inline" style="flex-wrap: wrap; gap: 6px">
          <button class="btn" @click="addRule">+ 新增规则</button>
          <select class="input input--sm" v-model="tpl">
            <option value="">模板（可选）</option>
            <option value="strip_think_tag">清理 &lt;think&gt;...&lt;/think&gt;</option>
            <option value="strip_analysis_tag">清理 &lt;analysis&gt;...&lt;/analysis&gt;</option>
            <option value="strip_thought_lines">清理 Thought/思考/推理 行</option>
          </select>
          <button class="btn" :disabled="!tpl" @click="addFromTemplate">套用模板</button>
          <button class="btn" @click="reload">重置</button>
          <button class="btn btn--primary" @click="save">保存</button>
          <button class="btn btn--danger" @click="resetToDefault">恢复默认</button>
        </div>
        <div class="hint">保存到服务端：/api/v1/settings（vcard.outputCleaner.config.rules）</div>
        <div class="hint">生效链路：turn/run 构建 messages 时清洗 assistant 历史；聊天显示由 /api/v1/drafts/:id/chat?view 决定。</div>
        <div class="hint" v-if="status">{{ status }}</div>
      </div>
    </div>

    <div v-for="(r, idx) in rules" :key="idx" class="vcardEntry">
      <header class="vcardEntry__header">
        <div class="vcardEntry__title">#{{ idx + 1 }} {{ r.name || "（未命名）" }}</div>
        <div class="vcardEntry__actions">
          <button class="btn btn--danger" @click="removeRule(idx)">删除</button>
        </div>
      </header>

      <div class="vcardEntry__grid">
        <label class="chk"><input type="checkbox" :checked="Boolean(r.enabled)" @change="setRuleField(idx, 'enabled', $event.target.checked)" /> enabled</label>
        <div class="inline">
          <select class="input input--sm" :value="r.style || 'raw'" @change="setRuleField(idx, 'style', $event.target.value)">
            <option value="raw">raw</option>
            <option value="slash">slash</option>
          </select>
          <input class="input input--sm" :value="r.name || ''" @change="setRuleField(idx, 'name', $event.target.value)" placeholder="name（可选）" />
          <input
            class="input input--sm"
            :value="r.flags || ''"
            :disabled="String(r.style || 'raw') === 'slash'"
            @change="setRuleField(idx, 'flags', $event.target.value)"
            placeholder="flags（style=raw 时生效；gimsuy）"
          />
        </div>
        <div class="vcardEntry__row">
          <div class="k">pattern</div>
          <textarea class="input" rows="3" :value="r.pattern || ''" @change="setRuleField(idx, 'pattern', $event.target.value)"></textarea>
          <div class="hint">提示：style=slash 时可直接粘贴 /.../flags（例如 /&lt;Think&gt;[\s\S]*?&lt;\\/Think&gt;/gs）。</div>
        </div>
        <div class="vcardEntry__row">
          <div class="k">replace</div>
          <textarea class="input" rows="2" :value="r.replace ?? ''" @change="setRuleField(idx, 'replace', $event.target.value)"></textarea>
        </div>
      </div>
    </div>

    <details class="vcardEntry">
      <summary class="vcardEntry__title">测试（可选）</summary>
      <div class="formRow">
        <div class="formLabel">原文</div>
        <div class="formCtrl">
          <textarea class="input" rows="6" v-model="sampleText" placeholder="粘贴一段 assistant 原文…"></textarea>
        </div>
      </div>
      <div class="inline">
        <button class="btn" @click="runSample">运行清洗</button>
      </div>
      <div class="formRow" v-if="sampleOut !== null">
        <div class="formLabel">结果</div>
        <div class="formCtrl">
          <pre class="code">{{ sampleOut }}</pre>
        </div>
      </div>
    </details>
  </details>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { getApiV1Settings, patchApiV1Settings } from "../../../../shared";
import { applyOutputCleaner, defaultOutputCleanerConfig, normalizeOutputCleanerConfig } from "../../domain/outputCleaner";

const emit = defineEmits(["saved"]);

const enabled = ref(true);
const writeBack = ref(true);
const rules = ref([]);
const tpl = ref("");
const status = ref("");
const sampleText = ref("");
const sampleOut = ref(null);
const busy = ref(false);

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

async function loadConfig() {
  status.value = "";
  busy.value = true;
  try {
    const settings = await getApiV1Settings();
    const vcard = settings?.vcard && typeof settings.vcard === "object" ? settings.vcard : {};
    const oc = vcard?.outputCleaner && typeof vcard.outputCleaner === "object" ? vcard.outputCleaner : {};

    const cfgRaw = isPlainObject(oc.config) ? oc.config : defaultOutputCleanerConfig();
    const cfg = normalizeOutputCleanerConfig(cfgRaw);
    enabled.value = Boolean(cfg.enabled);
    rules.value = (Array.isArray(cfg.rules) ? cfg.rules : []).map((r) => ({ ...r }));
    writeBack.value = oc.writeBack === undefined ? true : Boolean(oc.writeBack);
  } catch (err) {
    status.value = `加载失败：${String(err?.message || err)}`;
    const cfg = normalizeOutputCleanerConfig(defaultOutputCleanerConfig());
    enabled.value = Boolean(cfg.enabled);
    rules.value = (Array.isArray(cfg.rules) ? cfg.rules : []).map((r) => ({ ...r }));
    writeBack.value = true;
  } finally {
    busy.value = false;
  }
}

function buildConfigFromUi() {
  return normalizeOutputCleanerConfig({ version: "v1", enabled: Boolean(enabled.value), rules: Array.isArray(rules.value) ? rules.value : [] });
}

async function save() {
  if (busy.value) return;
  const cfg = buildConfigFromUi();
  busy.value = true;
  status.value = "";
  try {
    await patchApiV1Settings({ vcard: { outputCleaner: { writeBack: Boolean(writeBack.value), config: cfg } } });
    status.value = "已保存：下次 turn/run 将生效。";
    emit("saved");
  } catch (err) {
    status.value = `保存失败：${String(err?.message || err)}`;
  } finally {
    busy.value = false;
  }
}

function reload() {
  loadConfig().then(() => (status.value = "已重载。"));
}

async function resetToDefault() {
  if (busy.value) return;
  busy.value = true;
  status.value = "";
  try {
    await patchApiV1Settings({ vcard: { outputCleaner: { writeBack: true, config: defaultOutputCleanerConfig() } } });
    status.value = "已恢复默认。";
    await loadConfig();
    emit("saved");
  } catch (err) {
    status.value = `恢复默认失败：${String(err?.message || err)}`;
  } finally {
    busy.value = false;
  }
}

function addRule() {
  rules.value = [...(Array.isArray(rules.value) ? rules.value : []), { name: "", enabled: true, style: "raw", pattern: "", flags: "g", replace: "" }];
}

function ruleTemplate(id) {
  if (id === "strip_think_tag") return { name: "strip_think_tag", enabled: true, style: "raw", pattern: "<think>[\\s\\S]*?<\\/think>", flags: "gi", replace: "" };
  if (id === "strip_analysis_tag") return { name: "strip_analysis_tag", enabled: true, style: "raw", pattern: "<analysis>[\\s\\S]*?<\\/analysis>", flags: "gi", replace: "" };
  if (id === "strip_thought_lines") return { name: "strip_thought_lines", enabled: true, style: "raw", pattern: "^\\s*(Thought|思考|推理)\\s*[:：].*$", flags: "gmi", replace: "" };
  return null;
}

function addFromTemplate() {
  const t = ruleTemplate(tpl.value);
  if (!t) return;
  rules.value = [...(Array.isArray(rules.value) ? rules.value : []), t];
  tpl.value = "";
}

function removeRule(idx) {
  const next = Array.isArray(rules.value) ? rules.value.slice() : [];
  next.splice(idx, 1);
  rules.value = next;
}

function setRuleField(idx, key, value) {
  const next = Array.isArray(rules.value) ? rules.value.slice() : [];
  const cur = isPlainObject(next[idx]) ? next[idx] : {};
  const patch = { [key]: value };
  if (key === "pattern") {
    const s = String(value || "").trim();
    if (s.startsWith("/") && String(cur.style || "raw") !== "slash") patch.style = "slash";
  }
  next.splice(idx, 1, { ...cur, ...patch });
  rules.value = next;
}

function runSample() {
  const cfg = buildConfigFromUi();
  const res = applyOutputCleaner(sampleText.value, cfg);
  sampleOut.value = res.text;
}

onMounted(loadConfig);
</script>
