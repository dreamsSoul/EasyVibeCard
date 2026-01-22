<!--
文件：AppShell.vue
模块：应用壳层
作用：VSCode 风格壳层：活动栏 + 视图切换（chat/vcard/settings）
依赖：ActivityBar、ChatView、SettingsView、VCardPage、useChatState、useVCardState
@created 2025-12-28
@modified 2026-01-19
-->

<template>
  <div class="appShell">
    <ActivityBar :activeView="activeView" @select="activeView = $event" />

    <main class="appShell__main">
      <header class="titleBar">
        <div class="titleBar__title">预设聊天</div>
        <div class="titleBar__hint"></div>
      </header>

      <div class="appShell__content">
        <ChatView
          v-if="activeView === 'chat'"
          v-model="userInput"
          :chat="chat"
          :sending="sending"
          :activePresetName="activePreset?.name || ''"
          :activeProvider="activeProvider"
          :activeModel="activeModel"
          :streamEnabled="ui.stream"
          @send="sendMessage"
          @clear="clearChat"
        />

        <VCardPage
          v-else-if="activeView === 'vcard'"
          :state="vcardState"
          :activePresetName="activePreset?.name || ''"
          :activeProvider="activeProvider"
          :activeModel="activeModel"
          :ui="ui"
        />

        <SettingsView
          v-else
          :presets="presets"
          :selectedPresetName="selectedPresetName"
          :activePreset="activePreset"
          :activeProvider="activeProvider"
          :activeModel="activeModel"
          :api="api"
          :ctx="ctx"
          :ui="ui"
          :previewMessages="previewMessages"
          :debugState="debugState"
          :presetDirty="presetDirty"
          :presetIsBuiltin="presetIsBuiltin"
          :presetSaving="presetSaving"
          :presetSaveDisabled="presetSaveDisabled"
          :presetSaveHint="presetSaveHint"
          :presetSaveError="presetSaveError"
          :vcardState="vcardState"
          @update:selectedPresetName="selectedPresetName = $event"
          @importPresetFile="importPresetFromFile"
          @resetPreset="resetToBuiltInDefault"
          @exportPreset="exportActivePreset"
          @savePreset="saveActivePreset"
          @removePreset="removeActivePreset"
          @clearChat="clearChat"
        />
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { ChatView, useChatState } from "../modules/chat/index";
import { ActivityBar } from "../modules/shell/index";
import { SettingsView } from "../modules/settings/index";
import { VCardPage, useVCardState } from "../modules/vcard/index";

import "./appShell.css";

const activeView = ref("chat");

const {
  presets,
  selectedPresetName,
  activePreset,
  activeProvider,
  activeModel,
  api,
  ctx,
  ui,
  chat,
  userInput,
  sending,
  previewMessages,
  debugState,
  presetDirty,
  presetIsBuiltin,
  presetSaving,
  presetSaveDisabled,
  presetSaveHint,
  presetSaveError,
  importPresetFromFile,
  resetToBuiltInDefault,
  exportActivePreset,
  saveActivePreset,
  removeActivePreset,
  clearChat,
  sendMessage,
} = useChatState();

const vcardState = useVCardState({ activePreset, activeProvider, activeModel, api, ctx, ui });
</script>
