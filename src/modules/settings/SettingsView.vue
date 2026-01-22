<!--
文件：SettingsView.vue
模块：设置
作用：VSCode 风格设置页（AI/预设/上下文/VCard/调试）
依赖：VCardOutputCleanerEditor、VCardFindReplace
@created 2025-12-28
@modified 2026-01-19
-->
<template>
  <div class="settingsView">
    <header class="settingsView__header">
      <div class="settingsView__title">设置</div>
      <input v-model.trim="query" class="input input--search" placeholder="搜索设置（按分类关键字匹配）" />
      <div class="settingsView__meta">
        <span class="kv"><span class="k">提供方</span><span class="v">{{ providerLabel }}</span></span>
        <span class="kv"><span class="k">模型</span><span class="v">{{ activeModel }}</span></span>
      </div>
    </header>
    <div class="settingsView__body">
      <aside class="settingsNav">
        <button v-for="s in filteredSections" :key="s.id" class="settingsNav__item" :class="{ active: section === s.id }" @click="section = s.id">
          {{ s.title }}
        </button>
      </aside>
      <section class="settingsContent">
        <div v-if="section === 'ai'" class="settingsSection">
          <div class="settingsSection__title">AI 接口</div>
          <div class="formRow">
            <div class="formLabel">提供方</div>
            <div class="formCtrl">
              <select v-model="api.providerOverride" class="input">
                <option value="">自动（跟随预设 chat_completion_source）</option>
                <option value="openai">OpenAI 兼容（openai）</option>
                <option value="claude">Claude 兼容（claude）</option>
                <option value="makersuite">Gemini 兼容：AI Studio（makersuite）</option>
                <option value="vertexai">Gemini 兼容：Vertex（vertexai）</option>
              </select>
              <div class="hint">当前生效：{{ providerLabel }}（{{ activeProvider }}）</div>
            </div>
          </div>
          <div class="formRow">
            <div class="formLabel">上游 Base URL</div>
            <div class="formCtrl">
              <input v-model.trim="activeConn.baseUrl" class="input" placeholder="例如：http://localhost:11434/v1" />
              <div class="hint" v-if="activeProvider === 'openai'">OpenAI 兼容：通常形如 http(s)://host[:port]/v1</div>
              <div class="hint" v-else-if="activeProvider === 'claude'">Claude 兼容：通常形如 http(s)://host[:port]/v1（本项目会请求 /messages）</div>
              <div class="hint" v-else-if="activeProvider === 'makersuite'">Gemini 兼容（AI Studio）：通常填域名根（本项目自动拼 /v1beta/...）</div>
              <div class="hint" v-else>Gemini 兼容（Vertex）：可填你的兼容网关域名根；需要时再填写 region/projectId</div>
            </div>
          </div>
          <div class="formRow">
            <div class="formLabel">密钥（API Key）</div>
            <div class="formCtrl">
              <input v-model="activeConn.key" class="input" type="password" placeholder="可留空（取决于你的兼容网关）" />
              <label class="chk"><input type="checkbox" v-model="api.rememberKey" /> 记住</label>
              <div class="hint">按 provider 分开保存；未勾选“记住”时刷新会清空 key。</div>
            </div>
          </div>
          <div class="formRow" v-if="activeProvider === 'vertexai'">
            <div class="formLabel">Vertex 参数</div>
            <div class="formCtrl">
              <div class="inline">
                <input v-model.trim="activeConn.region" class="input input--sm" placeholder="区域（region，例如：us-central1）" />
                <input v-model.trim="activeConn.projectId" class="input input--sm" placeholder="项目 ID（projectId，可选）" />
              </div>
            </div>
          </div>
          <div class="formRow">
            <div class="formLabel">模型（可覆盖）</div>
            <div class="formCtrl">
              <input v-model.trim="api.modelOverride" class="input" placeholder="留空则使用预设对应模型字段（openai/claude/google/vertex）" />
            </div>
          </div>
          <div class="formRow">
            <div class="formLabel">行为</div>
            <div class="formCtrl">
              <label class="chk"><input type="checkbox" v-model="ui.stream" /> 流式输出（SSE）</label>
              <div class="hint">流式模式不回传调试信息（debug，避免污染 SSE）。需要调试请用非流式。</div>
              <div class="hint">Chat /api/v1/chat/threads/:id/turn?stream=true：后端事件 meta/delta/final/error。</div>
              <div class="hint">VCard /api/v1/vcard/turn?stream=true：后端事件 meta/read_request/read_result/delta/patch_ops/applied/final/error。</div>
            </div>
          </div>
          <div class="formRow" v-if="activePreset">
            <div class="formLabel">生成参数（来自当前预设）</div>
            <div class="formCtrl">
              <div class="inline">
                <label class="kv kv--input">
                  <span class="k">温度（temperature）</span>
                  <input v-model.number="activePreset.temperature" class="input input--sm" type="number" step="0.1" />
                </label>
                <label class="kv kv--input">
                  <span class="k">采样概率（top_p）</span>
                  <input v-model.number="activePreset.top_p" class="input input--sm" type="number" step="0.05" min="0" max="1" />
                </label>
                <label class="kv kv--input" v-if="activeProvider !== 'openai'">
                  <span class="k">Top K（top_k）</span>
                  <input v-model.number="activePreset.top_k" class="input input--sm" type="number" step="1" min="0" />
                </label>
                <label class="kv kv--input">
                  <span class="k">最大输出（max_tokens）</span>
                  <input v-model.number="activePreset.openai_max_tokens" class="input input--sm" type="number" step="1" min="1" />
                </label>
              </div>
              <div class="inline">
                <label class="chk"><input type="checkbox" v-model="activePreset.squash_system_messages" /> 合并连续 system（squash_system_messages）</label>
                <label class="chk"><input type="checkbox" v-model="activePreset.wrap_in_quotes" /> 用户消息加引号（wrap_in_quotes）</label>
              </div>
              <div class="inline" style="align-items: center; gap: 8px; margin-top: 6px">
                <button class="btn btn--primary" :disabled="presetSaveDisabled" @click="$emit('savePreset')">保存预设</button>
                <div class="hint" v-if="presetSaveHint">{{ presetSaveHint }}</div>
              </div>
              <div class="hint" v-if="presetIsBuiltin">内置默认预设不可修改，请先导入/复制为新预设。</div>
              <div class="error" v-if="presetSaveError">{{ presetSaveError }}</div>
            </div>
          </div>
          <div class="formRow" v-if="activePreset && activeProvider !== 'openai'">
            <div class="formLabel">系统提示词通道</div>
            <div class="formCtrl">
              <label class="chk" v-if="activeProvider === 'claude'">
                <input type="checkbox" v-model="activePreset.claude_use_sysprompt" />
                Claude：使用 system 通道（claude_use_sysprompt，关闭则 system→user）
              </label>
              <label class="chk" v-else>
                <input type="checkbox" v-model="activePreset.use_makersuite_sysprompt" />
                Gemini：使用 system 通道（use_makersuite_sysprompt，关闭则 system→user）
              </label>
            </div>
          </div>
          <div class="formRow" v-if="activeProvider !== 'openai'">
            <div class="formLabel">推理</div>
            <div class="formCtrl">
              <div class="inline">
                <select v-model="ui.reasoningEffort" class="input input--sm">
                  <option value="auto">自动</option>
                  <option value="min">最小</option>
                  <option value="low">低</option>
                  <option value="medium">中</option>
                  <option value="high">高</option>
                  <option value="max">最大</option>
                </select>
                <label class="chk" v-if="activeProvider === 'makersuite' || activeProvider === 'vertexai'">
                  <input type="checkbox" v-model="ui.includeReasoning" />
                  包含思考内容（includeReasoning）
                </label>
              </div>
              <div class="hint" v-if="activeProvider === 'claude'">Claude：仅 thinking-capable 模型会启用 thinking（budget 由 reasoningEffort 推导）。</div>
              <div class="hint" v-else>Gemini：仅支持 thinkingConfig 的模型会生效；includeReasoning 控制是否包含 thoughts。</div>
            </div>
          </div>
        </div>

        <div v-else-if="section === 'presets'" class="settingsSection">
          <div class="settingsSection__title">预设</div>
          <div class="formRow">
            <div class="formLabel">导入 JSON</div>
            <div class="formCtrl">
              <input type="file" accept=".json,application/json" @change="onImportPresetFile" />
              <div class="hint">导入 SillyTavern 对话补齐预设（Chat Completion，含 prompts/prompt_order）。</div>
            </div>
          </div>
          <div class="formRow">
            <div class="formLabel">选择预设</div>
            <div class="formCtrl">
              <select :value="selectedPresetName" class="input" @change="onSelectPresetChange">
                <option v-for="p in presets" :key="p.name" :value="p.name">{{ p.name }}</option>
              </select>
            </div>
          </div>
          <div class="formRow">
            <div class="formLabel">操作</div>
            <div class="formCtrl">
              <div class="inline">
                <button class="btn" @click="$emit('resetPreset')">重置为内置默认</button>
                <button class="btn" :disabled="!activePreset" @click="$emit('exportPreset')">导出当前预设</button>
                <button class="btn btn--danger" :disabled="presets.length <= 1" @click="$emit('removePreset')">删除当前</button>
              </div>
            </div>
          </div>
        </div>

        <div v-else-if="section === 'context'" class="settingsSection">
          <div class="settingsSection__title">上下文（marker 注入）</div>
          <div class="formRow" v-if="activePreset">
            <div class="formLabel">角色卡注入</div>
            <div class="formCtrl">
              <label class="chk"><input type="checkbox" v-model="activePreset.role_card_in_chat_history" /> 合并到 chatHistory（作为一条 user 历史消息）</label>
              <div class="hint">开启后：persona/char/personality/scenario 不再作为单独 system 消息出现在请求开头。</div>
            </div>
          </div>
          <div class="formRow">
            <div class="formLabel">称呼（user/char）</div>
            <div class="formCtrl">
              <div class="inline">
                <input v-model.trim="ctx.user" class="input input--sm" placeholder="" />
                <input v-model.trim="ctx.char" class="input input--sm" placeholder="" />
              </div>
            </div>
          </div>
          <div class="formRow">
            <div class="formLabel">人设（personaDescription）</div>
            <div class="formCtrl"><textarea v-model="ctx.personaDescription" class="input" rows="2"></textarea></div>
          </div>
          <div class="formRow">
            <div class="formLabel">角色设定（charDescription）</div>
            <div class="formCtrl"><textarea v-model="ctx.charDescription" class="input" rows="2"></textarea></div>
          </div>
          <div class="formRow">
            <div class="formLabel">角色性格（charPersonality）</div>
            <div class="formCtrl"><textarea v-model="ctx.charPersonality" class="input" rows="2"></textarea></div>
          </div>
          <div class="formRow">
            <div class="formLabel">场景（scenario）</div>
            <div class="formCtrl"><textarea v-model="ctx.scenario" class="input" rows="2"></textarea></div>
          </div>
          <div class="formRow">
            <div class="formLabel">世界信息-前（worldInfoBefore）</div>
            <div class="formCtrl"><textarea v-model="ctx.worldInfoBefore" class="input" rows="2"></textarea></div>
          </div>
          <div class="formRow">
            <div class="formLabel">世界信息-后（worldInfoAfter）</div>
            <div class="formCtrl"><textarea v-model="ctx.worldInfoAfter" class="input" rows="2"></textarea></div>
          </div>
          <div class="formRow">
            <div class="formLabel">对话示例（dialogueExamples）</div>
            <div class="formCtrl"><textarea v-model="ctx.dialogueExamples" class="input" rows="2"></textarea></div>
          </div>
        </div>

        <div v-else-if="section === 'vcard'" class="settingsSection">
          <div class="settingsSection__title">VCard 工具</div>
          <div class="hint">这些工具作用于 VCard 草稿与聊天上下文。</div>
          <VCardOutputCleanerEditor @saved="onOutputCleanerSaved" />
          <div v-if="!vcardDraft || !vcardApplyItems" class="vcardEditor__empty">（VCard 草稿未就绪）</div>
          <VCardFindReplace v-else :draft="vcardDraft" :applyItems="vcardApplyItems" />
        </div>

        <div v-else class="settingsSection">
          <div class="settingsSection__title">调试</div>

          <div class="formRow">
            <div class="formLabel">操作</div>
            <div class="formCtrl">
              <div class="inline">
                <button class="btn" @click="$emit('clearChat')">清空聊天</button>
                <button class="btn" @click="ui.showPreview = !ui.showPreview">{{ ui.showPreview ? "隐藏" : "查看" }} 消息数组预览（messages）</button>
                <button class="btn" @click="ui.showDebug = !ui.showDebug">{{ ui.showDebug ? "隐藏" : "查看" }} 调试信息（debug）</button>
              </div>
            </div>
          </div>

          <pre class="code" v-if="ui.showPreview">{{ JSON.stringify(previewMessages, null, 2) }}</pre>
          <pre class="code" v-if="ui.showDebug && debugState">{{ JSON.stringify(debugState, null, 2) }}</pre>
          <div class="error" v-if="ui.lastError">{{ ui.lastError }}</div>
        </div>
      </section>
    </div>
  </div>
</template>
<script setup>
import { computed, ref, watch } from "vue";
import VCardFindReplace from "../vcard/components/dialogs/VCardFindReplace.vue";
import VCardOutputCleanerEditor from "../vcard/components/editors/VCardOutputCleanerEditor.vue";
import "../vcard/styles/page.css";
import "../vcard/styles/widgets.css";

const props = defineProps({
  presets: { type: Array, required: true },
  selectedPresetName: { type: String, required: true },
  activePreset: { type: Object, default: null },
  activeProvider: { type: String, default: "" },
  activeModel: { type: String, default: "" },
  api: { type: Object, required: true },
  ctx: { type: Object, required: true },
  ui: { type: Object, required: true },
  previewMessages: { type: Array, required: true },
  debugState: { type: Object, default: null },
  presetDirty: { type: Boolean, default: false },
  presetIsBuiltin: { type: Boolean, default: false },
  presetSaving: { type: Boolean, default: false },
  presetSaveDisabled: { type: Boolean, default: false },
  presetSaveHint: { type: String, default: "" },
  presetSaveError: { type: String, default: "" },
  vcardState: { type: Object, default: null },
});

const activeConn = computed(() => {
  const provider = String(props.activeProvider || "");
  const byProvider = props.api?.providers?.[provider];
  if (byProvider && typeof byProvider === "object") return byProvider;
  return { baseUrl: "", key: "", region: "", projectId: "" };
});
const PROVIDER_LABEL = Object.freeze({ openai: "OpenAI 兼容", claude: "Claude 兼容", makersuite: "Gemini（AI Studio）", vertexai: "Gemini（Vertex）" });
const providerLabel = computed(() => PROVIDER_LABEL[String(props.activeProvider || "")] || String(props.activeProvider || ""));

const emit = defineEmits([
  "update:selectedPresetName",
  "importPresetFile",
  "resetPreset",
  "exportPreset",
  "savePreset",
  "removePreset",
  "clearChat",
]);

const query = ref("");
const section = ref("ai");
const vcardDraft = computed(() => props.vcardState?.draft?.value || null);
const vcardApplyItems = computed(() => (typeof props.vcardState?.applyItems === "function" ? props.vcardState.applyItems : null));

const SECTIONS = Object.freeze([
  { id: "ai", title: "AI 接口", keywords: ["ai", "provider", "model", "openai", "claude", "gemini", "vertex", "temperature", "top_p", "top_k", "max_tokens"] },
  { id: "presets", title: "预设", keywords: ["preset", "预设", "prompts", "prompt_order", "导入", "导出"] },
  { id: "context", title: "上下文", keywords: ["context", "上下文", "world", "persona", "scenario", "history"] },
  { id: "vcard", title: "VCard 工具", keywords: ["vcard", "output", "cleaner", "find", "replace", "清洗", "查找", "替换"] },
  { id: "debug", title: "调试", keywords: ["debug", "messages", "预览", "错误"] },
]);

const filteredSections = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return SECTIONS;
  return SECTIONS.filter((s) => `${s.title} ${s.keywords.join(" ")}`.toLowerCase().includes(q));
});

watch(
  () => filteredSections.value.map((s) => s.id).join(","),
  () => {
    if (filteredSections.value.some((s) => s.id === section.value)) return;
    section.value = filteredSections.value[0]?.id || "ai";
  }
);

function onImportPresetFile(e) {
  const file = e?.target?.files?.[0];
  if (!file) return;
  emit("importPresetFile", file);
  e.target.value = "";
}

function onSelectPresetChange(e) {
  const next = String(e?.target?.value || "");
  if (next === String(props.selectedPresetName || "")) return;
  if (props.presetDirty) {
    const ok = typeof globalThis.confirm === "function" ? globalThis.confirm("当前预设修改尚未保存，切换将丢弃改动。是否继续？") : true;
    if (!ok) {
      if (e?.target) e.target.value = props.selectedPresetName;
      return;
    }
  }
  emit("update:selectedPresetName", next);
}

async function onOutputCleanerSaved() {
  if (typeof props.vcardState?.syncChatViewFromSettings === "function") {
    await props.vcardState.syncChatViewFromSettings({ refreshChat: true });
  }
}
</script>
