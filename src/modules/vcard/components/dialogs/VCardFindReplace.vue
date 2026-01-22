<!--
文件：VCardFindReplace.vue
模块：角色卡设计器
作用：查找/替换（普通文本）+ 替换预览（仅展示命中与替换片段）
依赖：无
@created 2025-12-31
@modified 2025-12-31
-->

<template>
  <details class="vcardEditor" open>
    <summary class="vcardEditor__summary">查找/替换（普通文本）</summary>

    <div v-if="!draft" class="vcardEditor__empty">（草稿未就绪）</div>
    <template v-else>
      <div class="formRow">
        <div class="formLabel">查找</div>
        <div class="formCtrl">
          <input class="input input--search" :value="findText" placeholder="要查找的文本" @input="onChangeFind($event.target.value)" />
        </div>
      </div>

      <div class="formRow">
        <div class="formLabel">替换为</div>
        <div class="formCtrl">
          <input
            class="input input--search"
            :value="replaceText"
            placeholder="替换成（可为空）"
            @input="onChangeReplace($event.target.value)"
          />
          <div class="hint">应用替换后可用“撤销/重做”回档。</div>
        </div>
      </div>

      <div class="inline">
        <label class="chk"><input type="checkbox" :checked="caseSensitive" @change="caseSensitive = $event.target.checked" /> 区分大小写</label>
      </div>

      <div class="formRow">
        <div class="formLabel">范围</div>
        <div class="formCtrl">
          <div class="inline">
            <label v-for="f in CARD_FIELDS" :key="f.key" class="chk">
              <input type="checkbox" :checked="Boolean(scope[f.key])" @change="setScope(f.key, $event.target.checked)" />
              {{ f.label }}
            </label>
          </div>
        </div>
      </div>

      <div class="pillRow" v-if="findText.trim()">
        <div class="pill"><span class="k">命中</span><span class="v">{{ totalHits }}</span></div>
        <div class="pill"><span class="k">涉及字段</span><span class="v">{{ hitFields }}</span></div>
      </div>

      <details class="vcardEntry" :open="Boolean(findText.trim() && totalHits > 0)">
        <summary class="vcardEntry__title">替换预览（仅展示命中片段）</summary>

        <div v-if="!findText.trim()" class="vcardEditor__empty">（请输入查找文本）</div>
        <div v-else-if="totalHits === 0" class="vcardEditor__empty">（未命中）</div>

        <template v-else>
          <div v-for="r in hitResults" :key="r.key" class="vcardReplace__field">
            <div class="vcardReplace__fieldTitle">card.{{ r.key }}（{{ r.hits }}）</div>
            <div class="vcardReplace__diff">
              <div v-for="(s, idx) in r.samples" :key="idx" class="vcardReplace__sample">
                <div class="vcardReplace__line">
                  <span class="vcardReplace__mark vcardReplace__mark--del">{{ s.match }}</span>
                  <span class="vcardReplace__arrow">→</span>
                  <span class="vcardReplace__mark vcardReplace__mark--add">{{ replaceText }}</span>
                </div>
                <div class="vcardReplace__context" v-if="s.context">
                  <pre class="code">{{ s.context }}</pre>
                </div>
              </div>
              <div v-if="r.more > 0" class="hint">仅展示前 {{ PREVIEW_LIMIT }} 处，还有 {{ r.more }} 处未展示。</div>
            </div>
          </div>
        </template>
      </details>

      <div class="inline" style="margin-top: 10px">
        <button class="btn btn--primary" :disabled="!canApply" @click="applyReplace">应用替换</button>
      </div>
    </template>
  </details>
</template>

<script setup>
import { computed, reactive, ref } from "vue";

const PREVIEW_LIMIT = 3;
const CONTEXT_CHARS = 24;

const CARD_FIELDS = Object.freeze([
  { key: "description", label: "description" },
  { key: "personality", label: "personality" },
  { key: "scenario", label: "scenario" },
  { key: "first_mes", label: "first_mes" },
  { key: "mes_example", label: "mes_example" },
  { key: "creator_notes", label: "creator_notes" },
  { key: "system_prompt", label: "system_prompt" },
  { key: "post_history_instructions", label: "post_history_instructions" },
]);

const props = defineProps({
  draft: { type: Object, default: null },
  applyItems: { type: Function, required: true },
});

const findText = ref("");
const replaceText = ref("");
const caseSensitive = ref(true);
const scope = reactive({
  description: true,
  personality: true,
  scenario: true,
  first_mes: true,
  mes_example: true,
  creator_notes: false,
  system_prompt: false,
  post_history_instructions: false,
});

function onChangeFind(value) {
  findText.value = String(value || "");
}

function onChangeReplace(value) {
  replaceText.value = String(value || "");
}

function setScope(key, checked) {
  scope[key] = Boolean(checked);
}

function escapeRegExp(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pickOccurrences(text, needle, max) {
  const s = String(text || "");
  const q = String(needle || "");
  if (!q) return [];
  const out = [];
  let from = 0;
  while (out.length < max) {
    const idx = s.indexOf(q, from);
    if (idx < 0) break;
    out.push(idx);
    from = idx + Math.max(1, q.length);
  }
  return out;
}

function buildContextSnippet(text, idx, needle) {
  const s = String(text || "");
  const q = String(needle || "");
  if (!q) return "";
  const left = Math.max(0, idx - CONTEXT_CHARS);
  const right = Math.min(s.length, idx + q.length + CONTEXT_CHARS);
  const prefix = left > 0 ? "…" : "";
  const suffix = right < s.length ? "…" : "";
  return `${prefix}${s.slice(left, idx)}【${s.slice(idx, idx + q.length)}】${s.slice(idx + q.length, right)}${suffix}`;
}

function applyReplaceOnce(text, needle, replacement, cs) {
  const s = String(text || "");
  const q = String(needle || "");
  if (!q) return { hits: 0, out: s, sampleIdx: [] };

  if (cs) {
    const sampleIdx = pickOccurrences(s, q, PREVIEW_LIMIT);
    const hits = Math.max(0, s.split(q).length - 1);
    return { hits, out: s.split(q).join(String(replacement || "")), sampleIdx };
  }

  const re = new RegExp(escapeRegExp(q), "gi");
  const sampleIdx = [];
  let hits = 0;
  const out = s.replace(re, (m, offset) => {
    hits += 1;
    if (sampleIdx.length < PREVIEW_LIMIT) sampleIdx.push(Number(offset) || 0);
    return String(replacement || "");
  });
  return { hits, out, sampleIdx };
}

const results = computed(() => {
  const d = props.draft;
  const q = findText.value.trim();
  const cs = Boolean(caseSensitive.value);
  if (!d || !q) return [];

  return CARD_FIELDS.filter((f) => Boolean(scope[f.key])).map((f) => {
    const before = String(d?.card?.[f.key] || "");
    const rep = applyReplaceOnce(before, q, replaceText.value, cs);
    const samples = rep.sampleIdx.map((idx) => ({ match: q, context: buildContextSnippet(before, idx, q) }));
    const more = Math.max(0, rep.hits - samples.length);
    return { key: f.key, label: f.label, hits: rep.hits, before, after: rep.out, samples, more };
  });
});

const hitResults = computed(() => results.value.filter((r) => r.hits > 0));
const totalHits = computed(() => hitResults.value.reduce((sum, r) => sum + (Number(r.hits) || 0), 0));
const hitFields = computed(() => (hitResults.value.length ? String(hitResults.value.length) : "0"));
const canApply = computed(() => Boolean(props.draft && findText.value.trim() && totalHits.value > 0));

function applyReplace() {
  const d = props.draft;
  if (!d) return;
  const q = findText.value.trim();
  if (!q) return;

  const patch = hitResults.value
    .filter((r) => r.before !== r.after)
    .map((r) => ({ op: "set", path: `card.${r.key}`, value: r.after }));
  if (patch.length === 0) return;
  props.applyItems([{ kind: "card.patch", patch }]);
}
</script>
