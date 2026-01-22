<!--
文件：VCardPreview.vue
模块：角色卡设计器
作用：角色卡上/中/下预览（名片/正文/对话）
依赖：无
@created 2025-12-29
@modified 2025-12-29
-->

<template>
  <div class="vcardPreview">
    <div class="vcardPreview__title">角色卡预览（上/中/下）</div>
    <div v-if="!draft" class="vcardPreview__empty">（草稿未就绪）</div>

    <template v-else>
      <section class="vcardBlock">
        <div class="vcardBlock__title">上：名片区</div>
        <div class="kv"><span class="k">名称</span><span class="v">{{ name }}</span></div>
        <div class="kv"><span class="k">标签</span><span class="v">{{ tags }}</span></div>
      </section>

      <section class="vcardBlock">
        <div class="vcardBlock__title">中：正文区</div>
        <div class="vcardText"><div class="k">description</div><pre class="pre">{{ draft.card?.description || "" }}</pre></div>
        <div class="vcardText"><div class="k">personality</div><pre class="pre">{{ draft.card?.personality || "" }}</pre></div>
        <div class="vcardText"><div class="k">scenario</div><pre class="pre">{{ draft.card?.scenario || "" }}</pre></div>
      </section>

      <section class="vcardBlock">
        <div class="vcardBlock__title">下：对话区</div>
        <div class="vcardText"><div class="k">first_mes</div><pre class="pre">{{ draft.card?.first_mes || "" }}</pre></div>
        <div class="vcardText"><div class="k">mes_example</div><pre class="pre">{{ draft.card?.mes_example || "" }}</pre></div>
      </section>
    </template>
  </div>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  draft: { type: Object, default: null },
});

const name = computed(() => String(props.draft?.card?.name || "").trim() || "（未命名）");
const tags = computed(() => {
  const list = Array.isArray(props.draft?.card?.tags) ? props.draft.card.tags : [];
  return list.length ? list.join(" / ") : "（无）";
});
</script>

