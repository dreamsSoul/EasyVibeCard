<!--
文件：ChatView.vue
模块：聊天
作用：聊天视图（消息列表 + 输入框）
依赖：无
@created 2025-12-28
@modified 2025-12-28
-->

<template>
  <div class="chatView">
    <header class="chatView__header">
      <div class="chatView__title">聊天</div>
      <div class="chatView__meta">
        <span class="kv"><span class="k">预设</span><span class="v">{{ activePresetName }}</span></span>
        <span class="kv"><span class="k">提供方</span><span class="v">{{ providerLabel }}（{{ activeProvider }}）</span></span>
        <span class="kv"><span class="k">模型</span><span class="v">{{ activeModel }}</span></span>
        <span class="kv" v-if="streamEnabled"><span class="k">流式</span><span class="v">开</span></span>
      </div>
      <div class="chatView__actions">
        <button class="btn" :disabled="sending || chat.length === 0" @click="$emit('clear')">清空</button>
      </div>
    </header>

    <div class="chatView__body">
      <div class="chatList" ref="chatListRef">
        <div v-if="chat.length === 0" class="chatList__empty">还没有消息，发送一条试试～</div>
        <div v-for="(m, idx) in chat" :key="idx" class="chatMsg" :class="m.role">
          <div class="chatMsg__meta">
            <span class="chatMsg__role">{{ m.role }}</span>
            <span class="chatMsg__time">{{ m.time }}</span>
          </div>
          <div class="chatMsg__content">{{ m.content }}</div>
        </div>
      </div>

      <div class="composer">
        <textarea
          :value="modelValue"
          rows="3"
          class="composer__input"
          placeholder="输入消息（Ctrl/⌘ + Enter 发送）"
          @input="$emit('update:modelValue', $event.target.value)"
          @keydown="onComposerKeydown"
        ></textarea>
        <div class="composer__actions">
          <button class="btn btn--primary" :disabled="sending || !modelValue.trim()" @click="$emit('send')">
            {{ sending ? "发送中…" : "发送" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from "vue";

const props = defineProps({
  chat: { type: Array, required: true },
  modelValue: { type: String, required: true },
  sending: { type: Boolean, default: false },
  activePresetName: { type: String, default: "" },
  activeProvider: { type: String, default: "" },
  activeModel: { type: String, default: "" },
  streamEnabled: { type: Boolean, default: false },
});

const emit = defineEmits(["update:modelValue", "send", "clear"]);

const chatListRef = ref(null);
const PROVIDER_LABEL = Object.freeze({ openai: "OpenAI 兼容", claude: "Claude 兼容", makersuite: "Gemini（AI Studio）", vertexai: "Gemini（Vertex）" });
const providerLabel = computed(() => PROVIDER_LABEL[String(props.activeProvider || "")] || String(props.activeProvider || ""));

async function scrollToBottom() {
  await nextTick();
  const el = chatListRef.value;
  if (el) el.scrollTop = el.scrollHeight;
}

watch(
  () => {
    const last = props.chat?.[props.chat.length - 1];
    return `${props.chat.length}:${String(last?.role || "")}:${String(last?.content || "").length}`;
  },
  () => scrollToBottom()
);

function onComposerKeydown(e) {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (props.sending) return;
    if (!props.modelValue.trim()) return;
    emit("send");
  }
}
</script>
