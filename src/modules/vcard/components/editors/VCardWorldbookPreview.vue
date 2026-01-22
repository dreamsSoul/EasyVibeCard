<!--
文件：VCardWorldbookPreview.vue
模块：角色卡设计器
作用：世界书可视化预览（按位置/灯色/启用状态聚合，便于快速检查）
依赖：vcard/domain/worldbookPositions
@created 2025-12-31
@modified 2026-01-01
-->

<template>
  <details class="vcardEditor">
    <summary class="vcardEditor__summary">世界书预览（更直观）</summary>

    <div v-if="!draft" class="vcardEditor__empty">（草稿未就绪）</div>
    <template v-else>
      <div class="pillRow">
        <div class="pill"><span class="k">总条目</span><span class="v">{{ stats.total }}</span></div>
        <div class="pill"><span class="k">启用</span><span class="v">{{ stats.enabled }}</span></div>
        <div class="pill"><span class="k">蓝灯</span><span class="v">{{ stats.blue }}</span></div>
        <div class="pill"><span class="k">绿灯</span><span class="v">{{ stats.green }}</span></div>
      </div>
      <div class="hint">提示：order = ST insertion_order（优先级），数值越大越靠前注入；本预览按优先级从高到低展示。</div>

      <div class="formRow">
        <div class="formLabel">过滤</div>
        <div class="formCtrl">
          <input class="input input--search" :value="query" placeholder="按 comment / keys / content 搜索" @input="query = $event.target.value" />
          <div class="inline" style="margin-top: 8px">
            <label class="chk"><input type="checkbox" :checked="onlyEnabled" @change="onlyEnabled = $event.target.checked" /> 仅启用</label>
            <label class="chk"><input type="checkbox" :checked="showContent" @change="showContent = $event.target.checked" /> 展示内容</label>
          </div>
        </div>
      </div>

      <details v-for="g in groups" :key="g.position" class="vcardEntry" :open="g.openByDefault">
        <summary class="vcardEntry__title">
          {{ g.label }}（{{ g.items.length }}）
          <span class="vcardWbPrev__meta" v-if="g.items.length">
            蓝 {{ g.blue }} / 绿 {{ g.green }}
          </span>
        </summary>
        <div v-if="g.items.length === 0" class="vcardEditor__empty">（无条目）</div>
        <template v-else>
          <div v-for="(e, idx) in g.items" :key="String(e.id || idx)" class="vcardWbPrev__item">
            <div class="vcardWbPrev__head">
              <span class="vcardWbPrev__badge" :class="e.light === 'green' ? 'vcardWbPrev__badge--green' : 'vcardWbPrev__badge--blue'">{{ e.light === "green" ? "绿" : "蓝" }}</span>
              <span class="vcardWbPrev__badge" :class="e.enabled ? 'vcardWbPrev__badge--on' : 'vcardWbPrev__badge--off'">{{ e.enabled ? "启用" : "禁用" }}</span>
              <span class="vcardWbPrev__title">{{ e.comment || e.id || `#${idx + 1}` }}</span>
              <span class="vcardWbPrev__order">优先级(order)={{ Number(e.order) || 0 }}</span>
              <span v-if="e.at_depth?.depth !== undefined" class="vcardWbPrev__order">depth={{ Number(e.at_depth.depth) || 0 }}</span>
            </div>

            <div class="vcardWbPrev__keys" v-if="e.light === 'green'">
              <span class="vcardWbPrev__k">keys</span>
              <span class="vcardWbPrev__v">{{ fmtKeys(e.keys) || "（空）" }}</span>
            </div>

            <div v-if="showContent" class="vcardWbPrev__content">
              <pre class="pre">{{ e.content || "" }}</pre>
            </div>
          </div>
        </template>
      </details>
    </template>
  </details>
</template>

<script setup>
import { computed, ref } from "vue";
import { WORLDBOOK_POSITION_KEYS, WORLDBOOK_POSITION_LABEL } from "../../domain/worldbookPositions";

const props = defineProps({
  draft: { type: Object, default: null },
});

const query = ref("");
const onlyEnabled = ref(true);
const showContent = ref(false);

function fmtKeys(list) {
  const arr = Array.isArray(list) ? list : [];
  return arr.map((x) => String(x || "").trim()).filter(Boolean).join(", ");
}

function matchEntry(e, q) {
  const needle = String(q || "").trim().toLowerCase();
  if (!needle) return true;
  const comment = String(e?.comment || "").toLowerCase();
  const content = String(e?.content || "").toLowerCase();
  const keys = fmtKeys(e?.keys).toLowerCase();
  return comment.includes(needle) || content.includes(needle) || keys.includes(needle);
}

const rawEntries = computed(() => (Array.isArray(props.draft?.worldbook?.entries) ? props.draft.worldbook.entries : []));
const filteredEntries = computed(() => {
  const q = query.value;
  const list = rawEntries.value.filter((e) => matchEntry(e, q));
  return onlyEnabled.value ? list.filter((e) => Boolean(e?.enabled)) : list;
});

const stats = computed(() => {
  const all = rawEntries.value;
  const enabled = all.filter((e) => Boolean(e?.enabled));
  const blue = enabled.filter((e) => String(e?.light || "blue") !== "green").length;
  const green = enabled.filter((e) => String(e?.light || "") === "green").length;
  return { total: all.length, enabled: enabled.length, blue, green };
});

const groups = computed(() => {
  const list = filteredEntries.value.slice().sort((a, b) => (Number(b?.order) || 0) - (Number(a?.order) || 0));
  return WORLDBOOK_POSITION_KEYS.map((pos) => {
    const items = list.filter((e) => String(e?.position || "after_char") === pos);
    const blue = items.filter((e) => String(e?.light || "blue") !== "green").length;
    const green = items.filter((e) => String(e?.light || "") === "green").length;
    const openByDefault = Boolean(query.value.trim()) && items.length > 0;
    return { position: pos, label: WORLDBOOK_POSITION_LABEL[pos] || pos, items, blue, green, openByDefault };
  });
});
</script>
