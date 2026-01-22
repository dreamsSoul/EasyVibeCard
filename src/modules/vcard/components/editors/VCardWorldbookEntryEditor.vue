<!--
文件：VCardWorldbookEntryEditor.vue
模块：角色卡设计器
作用：Worldbook 单条条目编辑器（内容在上，元属性在下）
依赖：vcard/domain/worldbookPositions
@created 2026-01-20
@modified 2026-01-20
-->

<template>
  <div class="vcardWorldbookEntryEditor">
    <div v-if="!draft" class="vcardEditor__empty">（草稿未就绪）</div>
    <div v-else-if="!entry" class="error">（worldbook 条目不存在：index={{ index }}）</div>
    <template v-else>
      <div class="formRow">
        <div class="formLabel">content</div>
        <div class="formCtrl">
          <textarea class="input vcardWorldbookEntryEditor__content" rows="12" :value="String(entry.content || '')" @change="setField('content', $event.target.value)"></textarea>
          <div class="hint">长度：{{ String(entry.content || "").length }}</div>
        </div>
      </div>

      <details class="vcardEditor">
        <summary class="vcardEditor__summary">元属性</summary>

        <div class="formRow">
          <div class="formLabel">comment</div>
          <div class="formCtrl">
            <input class="input" :value="String(entry.comment || '')" @change="setField('comment', $event.target.value)" />
            <div class="hint">comment 会影响文件名显示（用于文件树路径）。</div>
          </div>
        </div>

        <div class="formRow">
          <div class="formLabel">enabled / light</div>
          <div class="formCtrl">
            <div class="inline">
              <label class="chk"><input type="checkbox" :checked="Boolean(entry.enabled)" @change="setField('enabled', $event.target.checked)" /> enabled</label>
              <select class="input input--sm" :value="String(entry.light || 'blue')" @change="setField('light', $event.target.value)">
                <option value="blue">蓝灯（常驻）</option>
                <option value="green">绿灯（关键词触发）</option>
              </select>
              <label class="chk"><input type="checkbox" :checked="Boolean(entry.use_regex)" @change="setField('use_regex', $event.target.checked)" /> use_regex</label>
            </div>
          </div>
        </div>

        <div class="formRow">
          <div class="formLabel">position / order</div>
          <div class="formCtrl">
            <div class="inline">
              <select class="input input--sm" :value="String(entry.position || 'after_char')" @change="onChangePosition($event.target.value)">
                <option v-for="k in positionKeys" :key="k" :value="k">{{ positionLabel[k] }}</option>
              </select>
              <input
                class="input input--sm"
                type="number"
                min="0"
                step="0.1"
                :value="Number.isFinite(Number(entry.order)) ? Number(entry.order) : 100"
                @change="setField('order', parseOrderNumber($event.target.value))"
                placeholder="order"
                title="order（= ST insertion_order；数值越大越靠前注入）"
              />
              <input
                v-if="isAtDepth(String(entry.position || ''))"
                class="input input--sm"
                type="number"
                min="0"
                :value="Number(entry.at_depth?.depth ?? 0)"
                @change="setField('at_depth', { depth: Number($event.target.value) })"
                placeholder="depth"
                title="at_depth.depth"
              />
            </div>
          </div>
        </div>

        <div class="formRow">
          <div class="formLabel">keys</div>
          <div class="formCtrl">
            <input class="input" :value="fmtKeys(entry.keys)" @change="setField('keys', parseKeys($event.target.value))" />
            <div class="hint">逗号/换行分隔；绿灯建议非空。</div>
          </div>
        </div>

        <div class="formRow">
          <div class="formLabel">secondary_keys</div>
          <div class="formCtrl">
            <input class="input" :value="fmtKeys(entry.secondary_keys)" @change="setField('secondary_keys', parseKeys($event.target.value))" />
          </div>
        </div>

        <div class="formRow">
          <div class="formLabel">secondary_logic</div>
          <div class="formCtrl">
            <select class="input input--sm" :value="String(entry.secondary_logic || 'and_any')" @change="setField('secondary_logic', $event.target.value)">
              <option value="and_any">and_any（默认）</option>
              <option value="and_all">and_all</option>
              <option value="not_any">not_any</option>
              <option value="not_all">not_all</option>
            </select>
          </div>
        </div>
      </details>
    </template>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { WORLDBOOK_POSITION_KEYS, WORLDBOOK_POSITION_LABEL, isAtDepthPositionKey } from "../../domain/worldbookPositions";

const props = defineProps({
  draft: { type: Object, default: null },
  applyItems: { type: Function, required: true },
  index: { type: [Number, String], required: true },
});

const idx = computed(() => Number(props.index));
const entries = computed(() => (Array.isArray(props.draft?.worldbook?.entries) ? props.draft.worldbook.entries : []));
const entry = computed(() => {
  const i = idx.value;
  if (!Number.isFinite(i) || i < 0 || i >= entries.value.length) return null;
  return entries.value[i] || null;
});

const positionKeys = WORLDBOOK_POSITION_KEYS;
const positionLabel = WORLDBOOK_POSITION_LABEL;

function isAtDepth(pos) {
  return isAtDepthPositionKey(pos);
}

function patchWorldbook(patch) {
  props.applyItems([{ kind: "worldbook.patch", patch }]);
}

function setField(field, value) {
  const i = idx.value;
  if (!Number.isFinite(i) || i < 0) return;
  patchWorldbook([{ op: "set", path: `worldbook.entries[${i}].${String(field)}`, value }]);
}

function parseOrderNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 100;
  return Math.max(0, n);
}

function fmtKeys(list) {
  return (Array.isArray(list) ? list : []).join(", ");
}

function parseKeys(text) {
  return String(text || "")
    .split(/,|\\n/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function onChangePosition(nextPos) {
  const i = idx.value;
  if (!Number.isFinite(i) || i < 0) return;
  const pos = String(nextPos || "after_char");
  const patch = [{ op: "set", path: `worldbook.entries[${i}].position`, value: pos }];
  if (isAtDepth(pos)) patch.push({ op: "set", path: `worldbook.entries[${i}].at_depth`, value: { depth: 0 } });
  patchWorldbook(patch);
}
</script>

<style scoped>
.vcardWorldbookEntryEditor__content {
  resize: vertical;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  font-size: 12px;
  line-height: 1.55;
}
</style>

