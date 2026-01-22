<!--
文件：ActivityBar.vue
模块：壳层
作用：左侧活动栏（仅：聊天/设置）
依赖：无
@created 2025-12-28
@modified 2025-12-28
-->

<template>
  <aside class="activityBar">
    <button class="activityBar__item" :class="{ active: activeView === 'chat' }" @click="$emit('select', 'chat')" title="聊天">
      <svg class="activityBar__icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M6 3h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H9l-4.2 3.1c-.5.4-1.2 0-1.2-.6V17A3 3 0 0 1 1 14V6a3 3 0 0 1 3-3h2Z"
          fill="currentColor"
          opacity=".9"
        />
      </svg>
      <span class="activityBar__label">聊天</span>
    </button>

    <button class="activityBar__item" :class="{ active: activeView === 'vcard' }" @click="$emit('select', 'vcard')" title="角色卡">
      <svg class="activityBar__icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M7 3h10a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm1.5 5.2h7a.8.8 0 1 0 0-1.6h-7a.8.8 0 1 0 0 1.6Zm0 4h7a.8.8 0 1 0 0-1.6h-7a.8.8 0 1 0 0 1.6Zm0 4h4.2a.8.8 0 0 0 0-1.6H8.5a.8.8 0 0 0 0 1.6Z"
          fill="currentColor"
          opacity=".9"
        />
      </svg>
      <span class="activityBar__label">角色卡</span>
    </button>

    <button
      class="activityBar__item"
      :class="{ active: activeView === 'settings' }"
      @click="$emit('select', 'settings')"
      title="设置"
    >
      <svg class="activityBar__icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M19.4 13a7.8 7.8 0 0 0 .1-1 7.8 7.8 0 0 0-.1-1l2-1.5a.8.8 0 0 0 .2-1l-1.9-3.3a.8.8 0 0 0-1-.3l-2.3 1a8.4 8.4 0 0 0-1.7-1l-.3-2.5a.8.8 0 0 0-.8-.7H9.4a.8.8 0 0 0-.8.7L8.3 4.9a8.4 8.4 0 0 0-1.7 1l-2.3-1a.8.8 0 0 0-1 .3L1.4 8.5a.8.8 0 0 0 .2 1l2 1.5a7.8 7.8 0 0 0-.1 1c0 .3 0 .7.1 1l-2 1.5a.8.8 0 0 0-.2 1l1.9 3.3a.8.8 0 0 0 1 .3l2.3-1c.5.4 1.1.7 1.7 1l.3 2.5c.1.4.4.7.8.7h3.2c.4 0 .7-.3.8-.7l.3-2.5c.6-.3 1.2-.6 1.7-1l2.3 1c.4.2.8 0 1-.3l1.9-3.3a.8.8 0 0 0-.2-1l-2-1.5ZM12 15.2A3.2 3.2 0 1 1 12 8.8a3.2 3.2 0 0 1 0 6.4Z"
          fill="currentColor"
          opacity=".9"
        />
      </svg>
      <span class="activityBar__label">设置</span>
    </button>

    <div class="activityBar__spacer"></div>

    <div class="activityBar__footer">ST 风格</div>
  </aside>
</template>

<script setup>
defineProps({
  activeView: { type: String, required: true },
});

defineEmits(["select"]);
</script>
