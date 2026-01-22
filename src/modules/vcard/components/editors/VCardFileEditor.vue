<!--
文件：VCardFileEditor.vue
模块：角色卡设计器
作用：文件级编辑器路由（根据 fileRef 渲染对应编辑器；兜底 raw 只读预览）
依赖：readProtocol、各类型化编辑器
@created 2026-01-20
@modified 2026-01-20
-->

<template>
  <div class="vcardFileEditor">
    <div v-if="!draft" class="vcardEditor__empty">（草稿未就绪）</div>
    <template v-else>
      <VCardCardTextEditor v-if="kind === 'card.field'" :draft="draft" :applyItems="applyItems" :fieldKey="fileRef.key" />
      <VCardAlternateGreetingEditor v-else-if="kind === 'card.alternate_greeting'" :draft="draft" :applyItems="applyItems" :index="fileRef.index" />
      <VCardWorldbookEntryEditor v-else-if="kind === 'worldbook.entry'" :draft="draft" :applyItems="applyItems" :index="fileRef.index" />
      <VCardRegexScriptEntryEditor v-else-if="kind === 'regex_scripts.entry'" :draft="draft" :applyItems="applyItems" :index="fileRef.index" />
      <VCardTavernHelperScriptEntryEditor v-else-if="kind === 'tavern_helper.script'" :draft="draft" :applyItems="applyItems" :index="fileRef.index" />
      <VCardTavernHelperVariableEditor v-else-if="kind === 'tavern_helper.variable'" :draft="draft" :applyItems="applyItems" :varKey="fileRef.key" />

      <div v-else class="vcardFileEditor__raw">
        <div class="hint">（该文件类型暂未类型化，当前为只读预览）</div>
        <pre class="code">{{ rawText }}</pre>
        <div class="error" v-if="rawError">{{ rawError }}</div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { resolveFileContent } from "../../domain/readProtocol";
import VCardAlternateGreetingEditor from "./VCardAlternateGreetingEditor.vue";
import VCardCardTextEditor from "./VCardCardTextEditor.vue";
import VCardRegexScriptEntryEditor from "./VCardRegexScriptEntryEditor.vue";
import VCardTavernHelperScriptEntryEditor from "./VCardTavernHelperScriptEntryEditor.vue";
import VCardTavernHelperVariableEditor from "./VCardTavernHelperVariableEditor.vue";
import VCardWorldbookEntryEditor from "./VCardWorldbookEntryEditor.vue";

const props = defineProps({
  draft: { type: Object, default: null },
  applyItems: { type: Function, required: true },
  fileRef: { type: Object, default: null },
  displayPath: { type: String, default: "" },
});

const kind = computed(() => String(props.fileRef?.kind || "").trim());

const rawResult = computed(() => {
  if (!props.draft) return { ok: false, text: "", error: "" };
  const path = String(props.displayPath || props.fileRef?.path || "").trim();
  if (!path) return { ok: false, text: "", error: "未选择文件。" };
  const res = resolveFileContent({ draft: props.draft, path, includeVibePlan: true });
  if (!res.ok) return { ok: false, text: "", error: res.error };
  const value = res.value;
  const json = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { ok: true, text: json ?? String(value ?? ""), error: "" };
});

const rawText = computed(() => (rawResult.value.ok ? rawResult.value.text : ""));
const rawError = computed(() => (rawResult.value.ok ? "" : rawResult.value.error));
</script>

