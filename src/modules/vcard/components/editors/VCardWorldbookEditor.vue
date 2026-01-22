<!--
文件：VCardWorldbookEditor.vue
模块：角色卡设计器
作用：世界书编辑器（蓝/绿灯 + 10 位置）
依赖：vcard/domain/worldbookPositions
@created 2025-12-29
@modified 2026-01-01
-->

<template>
  <details class="vcardEditor" open>
    <summary class="vcardEditor__summary">世界书（蓝/绿灯 + 10 位置）</summary>

    <div v-if="!draft" class="vcardEditor__empty">（草稿未就绪）</div>
    <template v-else>
      <div class="formRow">
        <div class="formLabel">worldbook.name</div>
        <div class="formCtrl">
          <input class="input" :value="draft.worldbook?.name || ''" @change="onChangeName($event.target.value)" />
          <div class="hint">留空会在导出时按角色名回填默认。</div>
        </div>
      </div>

      <div class="formRow">
        <div class="formLabel">条目</div>
        <div class="formCtrl">
          <div class="inline">
            <button class="btn" @click="addEntry">+ 新增条目</button>
            <button class="btn" :disabled="entries.length === 0" title="修复空/重复/非数字 id，重新分配为递增整数（保持条目顺序）" @click="repairEntryIds">
              一键修复 id
            </button>
            <select class="input input--sm" v-model="reorderScope" title="整理范围">
              <option value="all">整理范围：全部位置</option>
              <option v-for="k in positionKeys" :key="k" :value="k">整理范围：{{ positionLabel[k] }}</option>
            </select>
            <button class="btn" :disabled="entries.length === 0" @click="reorderOrders">一键整理 order</button>
          </div>
          <div class="hint">
            order = ST insertion_order（注入优先级/相对位置，数值越大越靠前；支持小数）。新增条目 id 会自动递增生成；导入数据 id 异常可点“一键修复 id”。绿灯必须填 keys；at_depth 位置必须填 depth。
          </div>
        </div>
      </div>

      <div v-for="(e, idx) in entries" :key="idx" class="vcardEntry">
        <header class="vcardEntry__header">
          <div class="vcardEntry__title">#{{ idx + 1 }} {{ e.comment || e.id || "（无标题）" }}</div>
          <div class="vcardEntry__actions">
            <button class="btn btn--danger" @click="removeEntry(idx)">删除</button>
          </div>
        </header>

        <div class="vcardEntry__grid">
          <label class="chk"><input type="checkbox" :checked="Boolean(e.enabled)" @change="setEntryField(idx, 'enabled', $event.target.checked)" /> enabled</label>

          <div class="inline">
            <select class="input input--sm" :value="e.light" @change="setEntryField(idx, 'light', $event.target.value)">
              <option value="blue">蓝灯（常驻）</option>
              <option value="green">绿灯（关键词触发）</option>
            </select>
            <select class="input input--sm" :value="e.position" @change="onChangePosition(idx, $event.target.value)">
              <option v-for="k in positionKeys" :key="k" :value="k">{{ positionLabel[k] }}</option>
            </select>
            <input
              class="input input--sm"
              type="number"
              min="0"
              step="0.1"
              :value="Number.isFinite(Number(e.order)) ? Number(e.order) : 100"
              @change="onChangeOrder(idx, $event.target.value)"
              placeholder="order"
              title="order（= ST insertion_order；数值越大越靠前注入）"
            />
            <input
              v-if="isAtDepth(e.position)"
              class="input input--sm"
              type="number"
              min="0"
              :value="e.at_depth?.depth ?? 0"
              @change="setEntryField(idx, 'at_depth', { depth: Number($event.target.value) })"
              placeholder="depth"
              title="at_depth.depth"
            />
          </div>

          <div class="vcardEntry__row">
            <div class="k">keys</div>
            <input class="input" :value="fmtKeys(e.keys)" @change="setEntryField(idx, 'keys', parseKeys($event.target.value))" />
          </div>

          <div class="vcardEntry__row">
            <div class="k">secondary_keys</div>
            <input
              class="input"
              :value="fmtKeys(e.secondary_keys)"
              @change="setEntryField(idx, 'secondary_keys', parseKeys($event.target.value))"
            />
          </div>

          <div class="vcardEntry__row">
            <div class="k">comment</div>
            <input class="input" :value="e.comment || ''" @change="setEntryField(idx, 'comment', $event.target.value)" />
          </div>

          <div class="vcardEntry__row">
            <div class="k">content</div>
            <textarea class="input" rows="4" :value="e.content || ''" @change="setEntryField(idx, 'content', $event.target.value)"></textarea>
          </div>
        </div>
      </div>
    </template>
  </details>
</template>

<script setup>
import { computed, ref } from "vue";
import { WORLDBOOK_POSITION_KEYS, WORLDBOOK_POSITION_LABEL, isAtDepthPositionKey } from "../../domain/worldbookPositions";
import { computeNextWorldbookEntryId, ensureWorldbookEntryIds } from "../../domain/worldbookEntryIds";

const props = defineProps({
  draft: { type: Object, default: null },
  applyItems: { type: Function, required: true },
});

const entries = computed(() => (Array.isArray(props.draft?.worldbook?.entries) ? props.draft.worldbook.entries : []));
const positionKeys = WORLDBOOK_POSITION_KEYS;
const positionLabel = WORLDBOOK_POSITION_LABEL;
const reorderScope = ref("all");

function isAtDepth(pos) {
  return isAtDepthPositionKey(pos);
}

function patchWorldbook(patch) {
  props.applyItems([{ kind: "worldbook.patch", patch }]);
}

function onChangeName(value) {
  patchWorldbook([{ op: "set", path: "worldbook.name", value }]);
}

function fmtKeys(list) {
  const arr = Array.isArray(list) ? list : [];
  return arr.join(", ");
}

function parseKeys(text) {
  return String(text || "")
    .split(/,|\n/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseOrderNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 100;
  return Math.max(0, n);
}

function addEntry() {
  const idx = entries.value.length;
  const id = computeNextWorldbookEntryId(entries.value);
  patchWorldbook([
    {
      op: "set",
      path: `worldbook.entries[${idx}]`,
      value: { id, enabled: true, light: "blue", keys: [], secondary_keys: [], comment: "", content: "", position: "after_char", order: 100, use_regex: true },
    },
  ]);
}

function repairEntryIds() {
  const res = ensureWorldbookEntryIds(entries.value);
  if (!res.changed) return;
  patchWorldbook([{ op: "set", path: "worldbook.entries", value: res.entries }]);
}

function removeEntry(idx) {
  patchWorldbook([{ op: "remove", path: `worldbook.entries[${idx}]` }]);
}

function setEntryField(idx, field, value) {
  patchWorldbook([{ op: "set", path: `worldbook.entries[${idx}].${field}`, value }]);
}

function onChangeOrder(idx, value) {
  setEntryField(idx, "order", parseOrderNumber(value));
}

function onChangePosition(idx, value) {
  const patch = [{ op: "set", path: `worldbook.entries[${idx}].position`, value }];
  if (isAtDepth(value)) patch.push({ op: "set", path: `worldbook.entries[${idx}].at_depth`, value: { depth: 0 } });
  patchWorldbook(patch);
}

function toOrderNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function buildReorderOrdersPatch(scope) {
  const base = 100;
  const step = 10;
  const list = entries.value;
  const groups = new Map();

  list.forEach((e, idx) => {
    const pos = String(e?.position || "after_char");
    if (scope !== "all" && scope !== pos) return;
    if (!groups.has(pos)) groups.set(pos, []);
    groups.get(pos).push({ idx, order: toOrderNumber(e?.order), tie: idx });
  });

  const patch = [];
  for (const items of groups.values()) {
    const sorted = items.slice().sort((a, b) => (b.order !== a.order ? b.order - a.order : a.tie - b.tie));
    const n = sorted.length;
    sorted.forEach((it, rank) => {
      const order = base + (n - 1 - rank) * step;
      patch.push({ op: "set", path: `worldbook.entries[${it.idx}].order`, value: order });
    });
  }

  return patch;
}

function reorderOrders() {
  const patch = buildReorderOrdersPatch(String(reorderScope.value || "all"));
  if (patch.length === 0) return;
  patchWorldbook(patch);
}
</script>
