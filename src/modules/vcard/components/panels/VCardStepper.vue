<!--
文件：VCardStepper.vue
模块：角色卡设计器
作用：展示 Vibe Coding 步骤状态（todo/doing/done/blocked）
依赖：无
@created 2025-12-29
@modified 2025-12-29
-->

<template>
  <div class="vcardStepper">
    <div class="vcardStepper__title">Vibe 步骤</div>
    <div v-if="!steps.length" class="vcardStepper__empty">（未初始化）</div>
    <div v-else class="vcardStepper__list">
      <div v-for="s in steps" :key="s.index" class="vcardStep" :class="s.status">
        <div class="vcardStep__dot"></div>
        <div class="vcardStep__main">
          <div class="vcardStep__name">Step {{ s.index }}/{{ total || 1 }} - {{ s.name }}</div>
          <div class="vcardStep__hint" v-if="s.status === 'blocked' && s.blockers?.length">{{ s.blockers[0] }}</div>
          <div class="vcardStep__hint" v-else-if="s.doneCriteria?.length">{{ s.doneCriteria[0] }}</div>
        </div>
        <div class="vcardStep__status">{{ statusLabel(s.status) }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  progress: { type: Object, default: null },
});

const steps = computed(() => (Array.isArray(props.progress?.steps) ? props.progress.steps : []));
const total = computed(() => steps.value.length || 0);

function statusLabel(status) {
  if (status === "done") return "完成";
  if (status === "blocked") return "阻塞";
  if (status === "doing") return "进行中";
  return "待办";
}
</script>
