<!--
文件：VCardPage.vue
模块：角色卡设计器
作用：Vibe Coding 工作台（三栏布局：侧边栏 | 工作台 | 助手栏）
依赖：useVCardState、VCardPreview、VCardChatView
@created 2025-12-29
@modified 2026-01-21
-->

<template>
  <div class="vcardPage">
    <div class="vcardPage__body">
      <!-- ========== 左侧栏：文件导航 ========== -->
      <aside class="vcardSidebar vcardSidebar--left">
        <VCardFileExplorer
          :tree="fileTree"
          :activePaths="readFocusPaths"
          :selectedPath="selectedFileDisplayPath"
          :initBoard="initBoard"
          :refreshFromBoard="refreshFromBoard"
          :resetWorkspace="resetWorkspace"
          :importCharaCardJson="importCharaCardJson"
          @select="handleSelectFile"
        />

        <div class="vcardHint" v-if="boardError">
          <div class="vcardHint__title">草稿看板状态</div>
          <div class="vcardHint__error">{{ boardError }}</div>
        </div>
      </aside>

      <!-- ========== 中间工作台：编辑器 / 预览 ========== -->
      <main class="vcardWorkbench">
        <div class="vcardWorkbench__tabs">
          <button class="vcardTab" :class="{ 'vcardTab--active': centerTab === 'editor' }" @click="centerTab = 'editor'">编辑器</button>
          <button class="vcardTab" :class="{ 'vcardTab--active': centerTab === 'preview' }" @click="centerTab = 'preview'">预览</button>
        </div>
        <div class="vcardWorkbench__content">
          <!-- 编辑器 Tab -->
          <div v-show="centerTab === 'editor'" class="vcardFileViewer">
            <div class="vcardFileViewer__head">
              <div class="vcardFileViewer__headLeft">
                <div class="vcardFileViewer__title">文件内容</div>
                <div class="vcardFileViewer__path">{{ selectedFileDisplayPath || "（未选择）" }}</div>
              </div>
              <div class="vcardFileViewer__actions">
                <button class="btn" :disabled="!canUndo" title="Ctrl/⌘ + Z（焦点不在输入框时）" @click="undo">撤销</button>
                <button class="btn" :disabled="!canRedo" title="Ctrl+Y 或 Ctrl/⌘ + Shift + Z（焦点不在输入框时）" @click="redo">重做</button>
              </div>
            </div>
            <div class="vcardFileViewer__body">
              <div v-if="!selectedFileDisplayPath" class="vcardFileViewer__empty">（点击左侧文件查看内容）</div>
              <VCardFileEditor v-else :draft="draft" :applyItems="applyItems" :fileRef="selectedFileRef" :displayPath="selectedFileDisplayPath" />
            </div>
          </div>
          <!-- 预览 Tab -->
          <div v-show="centerTab === 'preview'" class="vcardPreviewPane">
            <VCardPreview :draft="draft" />
            <div class="vcardHint" v-if="lastApply">
              <div class="vcardHint__title">已应用输出</div>
              <div class="vcardHint__row">时间：{{ lastApply.appliedAt }}</div>
              <div class="vcardHint__row">kind：{{ lastApply.kinds.join(" / ") }}</div>
              <div class="vcardHint__row">产物变更：{{ lastApply.artifactChanged ? "是" : "否" }}</div>
              <div class="vcardHint__row" v-if="Number(lastApply.changedPaths?.length || 0) > 0">变更字段：{{ Number(lastApply.changedPaths?.length || 0) }}</div>
              <div class="vcardHint__row" v-if="lastApply.warnings?.length">warnings：{{ lastApply.warnings.length }}</div>
              <div class="vcardHint__row" v-if="lastApply.preview?.worldbookName">
                世界书名：{{ lastApply.preview.worldbookName.before || "（空）" }} → {{ lastApply.preview.worldbookName.after || "（空）" }}
              </div>
              <details class="vcardWbDiff" open v-if="Number(lastApply.preview?.worldbookEntryDiffs?.length || 0) > 0">
                <summary class="vcardWbDiff__summary">世界书变更（{{ Number(lastApply.preview?.worldbookEntryDiffs?.length || 0) }}）</summary>
                <div v-for="d in lastApply.preview.worldbookEntryDiffs" :key="d.idx" class="vcardWbDiff__item">
                  <div class="vcardWbDiff__head">
                    <span class="vcardWbDiff__title">#{{ Number(d.idx) + 1 }} {{ d.title }}</span>
                    <span class="vcardWbDiff__fields" v-if="d.fields?.length">fields: {{ d.fields.join(", ") }}</span>
                  </div>
                  <div class="vcardWbDiff__block">
                    <div class="vcardWbDiff__label">Before</div>
                    <pre class="code vcardWbDiff__code">{{ d.beforeText }}</pre>
                  </div>
                  <div class="vcardWbDiff__block">
                    <div class="vcardWbDiff__label">After</div>
                    <pre class="code vcardWbDiff__code">{{ d.afterText }}</pre>
                  </div>
                </div>
              </details>
            </div>
          </div>
        </div>
      </main>

      <!-- ========== 右侧栏：助手 / 工具箱 / 日志 ========== -->
      <aside class="vcardSidebar vcardSidebar--right">
        <div class="vcardRightTabs">
          <button class="vcardTab" :class="{ 'vcardTab--active': rightTab === 'chat' }" @click="switchRightTab('chat')">助手</button>
          <button class="vcardTab" :class="{ 'vcardTab--active': rightTab === 'tools' }" @click="switchRightTab('tools')">工具箱</button>
        </div>
        <div class="vcardRightContent">
          <div class="vcardIssuesPane" v-show="issuesOpen">
            <div class="vcardIssuesPane__header">
              <div class="vcardIssuesPane__title">Problems / Issues</div>
              <button class="btn" @click="closeIssues">关闭</button>
            </div>
            <div class="vcardIssuesPane__body">
              <VCardIssuesPanel :draft="draft" />
            </div>
          </div>
          <!-- 助手 Tab -->
          <div v-show="rightTab === 'chat' && !issuesOpen" class="vcardRightPane">
		            <VCardChatView
		              v-model="userInput"
			              :chat="chat"
			              :ctx="ctx"
			              :sending="sending"
			              :stopping="stopping"
                    :workflowMode="workflowMode"
                    :settingsBusy="vcardSettingsBusy"
                    :soundEnabled="soundEnabled"
			              :progress="draft?.meta?.progress || null"
		              :canRestoreInput="canRestoreInput"
		              :restoreInputTitle="restoreInputTitle"
		              :canRetryLastAction="canRetryLastAction"
		              :retryLastActionTitle="retryLastActionTitle"
		              :pending="pending"
		              :pendingBusy="pendingBusy"
		              @send="sendMessage"
		              @cancelSend="cancelSend"
		              @replanKeepArtifacts="replanKeepArtifacts"
                @manualAdvanceCurrentTask="manualAdvanceCurrentTask"
                @toggleWorkflowMode="toggleWorkflowMode"
                @toggleSoundEnabled="toggleSoundEnabled"
		              @approvePendingPlan="approvePendingPlan"
		              @rejectPendingPlan="rejectPendingPlan"
		              @acceptPendingPatch="acceptPendingPatch"
		              @rejectPendingPatch="rejectPendingPatch"
              @askPending="askPending"
              @restoreInput="restoreInput"
              @retryLastAction="retryLastAction"
              @clear="clearChat"
              @navigateToFile="handleSelectFile"
            />
          </div>
          <!-- 工具箱 Tab -->
          <div v-show="rightTab === 'tools' && !issuesOpen" class="vcardRightPane vcardToolsPane">
            <div class="vcardToolsTabs">
              <button class="vcardSubTab" :class="{ 'vcardSubTab--active': toolsSubTab === 'io' }" @click="toolsSubTab = 'io'">导入导出</button>
              <button class="vcardSubTab" :class="{ 'vcardSubTab--active': toolsSubTab === 'promptPack' }" @click="toolsSubTab = 'promptPack'">PromptPack</button>
              <button class="vcardSubTab" :class="{ 'vcardSubTab--active': toolsSubTab === 'assets' }" @click="toolsSubTab = 'assets'">资源</button>
            </div>
            <div class="vcardToolsContent">
              <div v-show="toolsSubTab === 'io'">
                <VCardImportExport :importCharaCardJson="importCharaCardJson" :exportCharaCardJson="exportCharaCardJson" :exportMode="exportMode" :setExportMode="setExportMode" />
              </div>
              <div v-show="toolsSubTab === 'promptPack'">
                <VCardPromptPackTemplatesEditor :ctx="ctx" />
              </div>
              <div v-show="toolsSubTab === 'assets'">
                <VCardAssetsManager :importCharaCardJson="importCharaCardJson" />
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>

    <footer class="vcardStatusbar">
      <div class="vcardStatusbar__group">
        <span class="vcardStatusbar__item"><span class="k">状态</span><span class="v">{{ runStatusText }}</span></span>
        <span class="vcardStatusbar__item"><span class="k">Step</span><span class="v">{{ stepText }}</span></span>
        <span class="vcardStatusbar__item"><span class="k">Mode</span><span class="v">{{ planWorkModeText }}</span></span>
        <span v-if="pendingKind" class="vcardStatusbar__item vcardStatusbar__item--pending"><span class="k">Pending</span><span class="v">{{ pendingKind }}</span></span>
      </div>
      <div class="vcardStatusbar__group vcardStatusbar__group--right">
        <span class="vcardStatusbar__item"><span class="k">Preset</span><span class="v">{{ presetLabel }}</span></span>
        <span class="vcardStatusbar__item"><span class="k">Provider</span><span class="v">{{ providerLabel }}</span></span>
        <span class="vcardStatusbar__item"><span class="k">Model</span><span class="v">{{ modelLabel }}</span></span>
        <span v-if="streamEnabled" class="vcardStatusbar__item"><span class="k">Stream</span><span class="v">On</span></span>
        <button class="vcardStatusbar__item vcardStatusbar__item--link" :class="{ 'is-alert': hasIssues }" type="button" @click="openIssues">
          <span class="k">Errors/Warns</span><span class="v">{{ errorCount }}/{{ warnCount }}</span>
        </button>
        <span class="vcardStatusbar__item"><span class="k">Updated</span><span class="v">{{ updatedAtText }}</span></span>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import VCardChatView from "../panels/VCardChatView.vue";
import VCardFileExplorer from "../panels/VCardFileExplorer.vue";
import VCardAssetsManager from "../dialogs/VCardAssetsManager.vue";
import VCardImportExport from "../dialogs/VCardImportExport.vue";
import VCardPreview from "../panels/VCardPreview.vue";
import VCardFileEditor from "../editors/VCardFileEditor.vue";
import VCardPromptPackTemplatesEditor from "../editors/VCardPromptPackTemplatesEditor.vue";
import VCardIssuesPanel from "../panels/VCardIssuesPanel.vue";
import { useVCardPageMeta } from "../../composables/useVCardPageMeta";
import { buildFileTree } from "../../domain/fileSystemSummary";
import { pickVCardFileRef, resolvePathFromFileRef } from "../../domain/fileSelection";
import "../../styles/page.css";
import "../../styles/widgets.css";

const props = defineProps({
  state: { type: Object, required: true },
  activePresetName: { type: String, default: "" },
  activeProvider: { type: String, default: "" },
  activeModel: { type: String, default: "" },
  ui: { type: Object, required: true },
});

		const {
		  ctx, chat, userInput, sending, stopping, runLog, draft, boardError, lastApply, readFocusPaths, eventLog,
      workflowMode, vcardSettingsBusy, soundEnabled,
		  pending, pendingBusy,
		  canRestoreInput, restoreInputTitle, restoreInput, canRetryLastAction, retryLastActionTitle, retryLastAction,
		  exportMode, canUndo, canRedo, initBoard, clearChat, clearRunLog, clearEventLog, refreshFromBoard, writeBoard, replanKeepArtifacts,
		  approvePendingPlan, rejectPendingPlan, acceptPendingPatch, rejectPendingPatch, askPending,
		  manualAdvanceCurrentTask, applyItems, importCharaCardJson, exportCharaCardJson, setExportMode, undo, redo,
		  cancelSend, sendMessage,
      toggleWorkflowMode, toggleSoundEnabled,
		} = props.state;

const {
  stepText, planWorkModeText, updatedAt, errorCount, warnCount,
  resetWorkspace,
		} = useVCardPageMeta({
		  draft,
		  userInput,
		  writeBoard,
		  sending,
      workflowMode,
		  canUndo,
	  canRedo,
	  undo,
	  redo,
	  clearRunLog,
  clearChat,
  initBoard,
});

// 中间工作台 Tab 状态
const centerTab = ref("editor");
// 右侧栏 Tab 状态
const rightTab = ref("chat");
// 工具箱子 Tab 状态
const toolsSubTab = ref("io");

const selectedFilePath = ref("");
const selectedFileRef = ref(null);
const fileTree = computed(() => (draft?.value ? buildFileTree(draft.value) : null));
const selectedFileDisplayPath = computed(() => {
  const resolved = resolvePathFromFileRef({ fileTree: fileTree.value, fileRef: selectedFileRef.value });
  return resolved || String(selectedFilePath.value || "");
});
const issuesOpen = ref(false);
const runStatusText = computed(() => {
  if (stopping.value) return "Stopping";
  if (sending.value) return "Sending";
  return "Ready";
});
const pendingKind = computed(() => String(pending?.value?.kind || "").trim());
const streamEnabled = computed(() => Boolean(props.ui?.stream));
const presetLabel = computed(() => String(props.activePresetName || "").trim() || "—");
const PROVIDER_LABEL = Object.freeze({ openai: "OpenAI 兼容", claude: "Claude 兼容", makersuite: "Gemini（AI Studio）", vertexai: "Gemini（Vertex）" });
const providerLabel = computed(() => {
  const raw = String(props.activeProvider || "").trim();
  return PROVIDER_LABEL[raw] || raw || "—";
});
const modelLabel = computed(() => String(props.activeModel || "").trim() || "—");
const updatedAtText = computed(() => String(updatedAt.value || "").trim() || "—");
const hasIssues = computed(() => Number(errorCount.value) + Number(warnCount.value) > 0);

function handleSelectFile(path) {
  selectedFilePath.value = String(path || "");
  const picked = pickVCardFileRef({ draft: draft?.value || null, path: selectedFilePath.value });
  selectedFileRef.value = picked.ok ? picked.ref : { kind: "raw", path: selectedFilePath.value };
  // 自动切换到编辑器 Tab
  centerTab.value = "editor";
}

function openIssues() {
  issuesOpen.value = true;
}

function closeIssues() {
  issuesOpen.value = false;
}

function switchRightTab(tab) {
  issuesOpen.value = false;
  rightTab.value = String(tab || "chat");
}

watch(
  () => (Array.isArray(readFocusPaths?.value) ? readFocusPaths.value : []),
  (paths) => {
    if (!selectedFileDisplayPath.value && paths.length > 0 && String(paths[0] || "").includes("/")) handleSelectFile(paths[0]);
  }
);
</script>
