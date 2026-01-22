<!--
文件：VCardFileExplorer.vue
模块：角色卡设计器
作用：文件系统浏览器（角色卡结构树）
依赖：无
@created 2026-01-05
@modified 2026-01-20
-->

<template>
  <div
    class="vcardExplorer"
    :class="{ 'is-dragover': dragActive }"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <div v-if="dragActive" class="vcardExplorer__overlay">
      <div class="vcardExplorer__overlayText">拖拽 PNG/JSON 到此导入；拖拽图片到此上传到资源</div>
    </div>

    <div class="vcardExplorer__header">
      <div class="vcardExplorer__title">文件</div>
      <details ref="menuRef" class="vcardExplorerMenu">
        <summary class="vcardExplorerMenu__trigger" title="更多">⋯</summary>
        <div class="vcardExplorerMenu__panel">
          <button type="button" class="vcardExplorerMenu__item" @click="onInitBoard">一键生成草稿看板</button>
          <button type="button" class="vcardExplorerMenu__item" @click="onRefreshFromBoard">从看板重新解析</button>
          <div class="vcardExplorerMenu__divider"></div>
          <div class="vcardExplorerMenu__dangerTitle">危险区</div>
          <button type="button" class="vcardExplorerMenu__item vcardExplorerMenu__item--danger" @click="onResetWorkspace">清空角色卡</button>
        </div>
      </details>
    </div>
    <div class="hint" v-if="status">{{ status }}</div>
    <div class="error" v-if="error">{{ error }}</div>
    <div v-if="!tree" class="vcardExplorer__empty">（草稿未就绪）</div>
    <div v-else class="vcardExplorer__list">
      <div v-for="item in visibleNodes" :key="item.node.path" class="vcardExplorer__row" :style="{ paddingLeft: `${item.depth * 14}px` }">
        <button v-if="item.node.type === 'folder'" class="vcardExplorer__toggle" @click="toggle(item.node.path)">
          {{ isCollapsed(item.node.path) ? "▸" : "▾" }}
        </button>
        <span v-else class="vcardExplorer__toggle vcardExplorer__toggle--spacer"></span>
        <button
          class="vcardExplorer__item"
          :class="{ 'is-folder': item.node.type === 'folder', 'is-active': isActive(item.node.path), 'is-selected': isSelected(item.node.path) }"
          @click="handleSelect(item.node)"
        >
          <span class="vcardExplorer__icon">{{ item.node.type === "folder" ? "📁" : "📄" }}</span>
          <span class="vcardExplorer__name">{{ item.node.name }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from "vue";

const props = defineProps({
  tree: { type: Object, default: null },
  activePaths: { type: Array, default: () => [] },
  selectedPath: { type: String, default: "" },
  initBoard: { type: Function, default: null },
  refreshFromBoard: { type: Function, default: null },
  resetWorkspace: { type: Function, default: null },
  importCharaCardJson: { type: Function, default: null },
});

const emit = defineEmits(["select"]);

const menuRef = ref(null);
const collapsed = ref(new Set());
const activeSet = computed(() => new Set(Array.isArray(props.activePaths) ? props.activePaths : []));
const busy = ref(false);
const status = ref("");
const error = ref("");
const dragCounter = ref(0);
const dragActive = ref(false);

function isCollapsed(path) {
  return collapsed.value.has(String(path || ""));
}

function toggle(path) {
  const key = String(path || "");
  const next = new Set(collapsed.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  collapsed.value = next;
}

function isActive(path) {
  return activeSet.value.has(String(path || ""));
}

function isSelected(path) {
  return String(props.selectedPath || "") === String(path || "");
}

function handleSelect(node) {
  if (!node) return;
  if (node.type === "folder") return toggle(node.path);
  emit("select", node.path);
}

function closeMenu() {
  if (menuRef.value) menuRef.value.open = false;
}

function onInitBoard() {
  if (typeof props.initBoard === "function") props.initBoard({ force: false });
  closeMenu();
}

function onRefreshFromBoard() {
  if (typeof props.refreshFromBoard === "function") props.refreshFromBoard();
  closeMenu();
}

function onResetWorkspace() {
  if (typeof props.resetWorkspace === "function") props.resetWorkspace();
  closeMenu();
}

function setMsg({ nextStatus, nextError }) {
  status.value = String(nextStatus || "");
  error.value = String(nextError || "");
}

function hasFileDrag(e) {
  const items = Array.from(e?.dataTransfer?.items || []);
  if (items.length === 0) return Array.from(e?.dataTransfer?.files || []).length > 0;
  return items.some((item) => item.kind === "file");
}

function onDragEnter(e) {
  if (!hasFileDrag(e)) return;
  dragCounter.value += 1;
  dragActive.value = true;
}

function onDragOver(e) {
  if (!hasFileDrag(e)) return;
  e.preventDefault();
}

function onDragLeave(e) {
  if (!hasFileDrag(e)) return;
  dragCounter.value = Math.max(0, dragCounter.value - 1);
  if (dragCounter.value === 0) dragActive.value = false;
}

async function extractCardFromPng(file) {
  const fd = new FormData();
  fd.append("png", file, file.name);
  const res = await fetch("/api/vcard/png/extract", { method: "POST", body: fd });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw new Error(json?.error || `${res.status} ${res.statusText}`);
  return json.card;
}

async function uploadAsset(file) {
  const fd = new FormData();
  fd.append("file", file, file.name);
  const res = await fetch("/api/vcard/assets/upload", { method: "POST", body: fd });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw new Error(json?.error || `${res.status} ${res.statusText}`);
  return json.asset;
}

async function importCard(card) {
  if (typeof props.importCharaCardJson !== "function") return setMsg({ nextError: "当前页面未绑定 importCharaCardJson（无法导入）。" });
  if (!confirm("确定导入并覆盖当前草稿吗？\n\n- 将创建新草稿并刷新文件树\n- 对话记录也会随草稿切换")) return;
  await props.importCharaCardJson(card);
  setMsg({ nextStatus: "已导入角色卡。" });
}

async function onDrop(e) {
  if (!hasFileDrag(e)) return;
  e.preventDefault();
  dragCounter.value = 0;
  dragActive.value = false;
  const files = Array.from(e?.dataTransfer?.files || []);
  if (files.length === 0) return;

  setMsg({ nextStatus: "", nextError: "" });
  if (busy.value) return;
  busy.value = true;
  try {
    if (files.length === 1) {
      const f = files[0];
      const name = String(f?.name || "");
      const mime = String(f?.type || "");

      if (mime === "application/json" || name.toLowerCase().endsWith(".json")) {
        const text = await f.text();
        const obj = JSON.parse(text);
        await importCard(obj);
        return;
      }

      if (mime === "image/png") {
        try {
          const card = await extractCardFromPng(f);
          if (!confirm("检测到 PNG 角色卡元数据：是否解析并导入为当前角色卡？\n\n（取消则仅上传到资源管理器）")) {
            await uploadAsset(f);
            setMsg({ nextStatus: "已上传 PNG 到资源管理器（工具箱 → 资源）。" });
            return;
          }
          await importCard(card);
          return;
        } catch (err) {
          // 不是角色卡 PNG：降级为资源上传
          await uploadAsset(f);
          setMsg({ nextStatus: "PNG 未解析到角色卡元数据，已上传到资源管理器（工具箱 → 资源）。" });
          return;
        }
      }

      if (mime.startsWith("image/")) {
        await uploadAsset(f);
        setMsg({ nextStatus: "已上传资源（工具箱 → 资源）。" });
        return;
      }
    }

    const images = files.filter((f) => String(f?.type || "").startsWith("image/"));
    if (images.length > 0) {
      let okCount = 0;
      for (const f of images) {
        try {
          await uploadAsset(f);
          okCount += 1;
        } catch (err) {
          setMsg({ nextError: `上传失败：${String(err?.message || err)}` });
          break;
        }
      }
      if (okCount > 0) setMsg({ nextStatus: `已上传 ${okCount} 个资源（工具箱 → 资源）。` });
      return;
    }

    setMsg({ nextError: "拖拽文件不支持：仅支持 PNG/JSON 导入，或图片上传。" });
  } catch (err) {
    setMsg({ nextError: `拖拽处理失败：${String(err?.message || err)}` });
  } finally {
    busy.value = false;
  }
}

const visibleNodes = computed(() => {
  if (!props.tree) return [];
  const out = [];
  const walk = (node, depth) => {
    if (!node) return;
    out.push({ node, depth });
    if (node.type !== "folder") return;
    if (isCollapsed(node.path)) return;
    const children = Array.isArray(node.children) ? node.children : [];
    for (const child of children) walk(child, depth + 1);
  };
  walk(props.tree, 0);
  return out;
});

watch(
  () => props.tree?.path,
  () => {
    collapsed.value = new Set();
  }
);
</script>
