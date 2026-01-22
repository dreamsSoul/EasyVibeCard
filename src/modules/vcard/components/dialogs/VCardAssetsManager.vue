<!--
文件：VCardAssetsManager.vue
模块：角色卡设计器
作用：资源管理器（上传/预览/复制引用/删除）
依赖：后端 /api/vcard/assets/*
@created 2025-12-29
@modified 2026-01-19
-->

<template>
  <details
    class="vcardEditor vcardAssets"
    :class="{ 'is-dragover': dragActive }"
    open
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <summary class="vcardEditor__summary">资源管理器（图片 / 角色卡 PNG）</summary>

    <div v-if="dragActive" class="vcardAssets__overlay">
      <div class="vcardAssets__overlayText">拖拽图片到此上传</div>
    </div>

    <div class="inline" style="margin-top: 10px">
      <button class="btn" :disabled="busy" @click="fileRef?.click()">上传图片</button>
      <button class="btn" :disabled="busy" @click="refresh">刷新</button>
    </div>
    <input ref="fileRef" type="file" accept="image/*" multiple style="display: none" @change="onPickFiles" />

    <div class="hint" v-if="status">{{ status }}</div>
    <div class="error" v-if="error">{{ error }}</div>

    <details v-if="selectedAsset" class="vcardEditor" style="margin-top: 10px" open>
      <summary class="vcardEditor__summary">角色卡信息（点击图片选择）</summary>
      <div class="assetSelected">
        <div class="assetSelected__left">
          <div class="assetThumbWrap assetThumbWrap--selected">
            <img class="assetThumb" :src="selectedAsset.url" :alt="selectedAsset.name" @load="onSelectedImageLoad" />
          </div>
          <div class="assetMeta">
            <div class="assetName" :title="selectedAsset.name">{{ selectedAsset.name }}</div>
            <div class="assetInfo">{{ formatSize(selectedAsset.size) }}{{ selectedImageDimText }}</div>
          </div>
        </div>

        <div class="assetSelected__right">
          <div class="inline" style="gap: 6px; flex-wrap: wrap">
            <button class="btn" :disabled="busy || extracting || !selectedCard" @click="loadSelectedCard">加载为当前角色卡</button>
            <button class="btn" :disabled="busy || extracting || !selectedCard" @click="copyCardJson">复制卡 JSON</button>
            <button class="btn" :disabled="busy || extracting" @click="copyText(selectedAsset.url)">复制图片链接</button>
            <button class="btn" :disabled="busy || extracting" @click="copyText(buildMarkdown(selectedAsset))">复制 Markdown</button>
          </div>

          <div class="hint" v-if="extracting" style="margin-top: 8px">正在解析 PNG 角色卡信息…</div>
          <div class="error" v-else-if="selectedCardError" style="margin-top: 8px">{{ selectedCardError }}</div>
          <pre v-else-if="selectedCard" class="code" style="margin-top: 8px; max-height: 200px">{{ selectedCardInfoText }}</pre>
          <div v-else class="vcardEditor__empty" style="margin-top: 8px">（未解析到角色卡信息）</div>
        </div>
      </div>
    </details>

    <div v-if="assets.length === 0" class="vcardEditor__empty">（暂无资源，上传一张图片试试～）</div>

    <div class="assetGrid" v-else>
      <div v-for="a in assets" :key="a.id" class="assetCard">
        <div class="assetThumbWrap" :class="{ 'assetThumbWrap--active': selectedAsset?.id === a.id }" @click="selectAsset(a)">
          <img class="assetThumb" :src="a.url" :alt="a.name" />
        </div>
        <div class="assetMeta">
          <div class="assetName" :title="a.name">{{ a.name }}</div>
          <div class="assetInfo">{{ formatSize(a.size) }}</div>
        </div>
        <div class="inline" style="margin-top: 6px; gap: 6px; flex-wrap: wrap">
          <button class="btn" :disabled="busy" @click.stop="copyText(a.url)">复制链接</button>
          <button class="btn" :disabled="busy" @click.stop="copyText(buildMarkdown(a))">复制 Markdown</button>
          <button class="btn btn--danger" :disabled="busy" @click.stop="removeAsset(a)">删除</button>
        </div>
      </div>
    </div>
  </details>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";

import "../../styles/assets-manager.css";

const props = defineProps({
  importCharaCardJson: { type: Function, default: null },
});

const busy = ref(false);
const status = ref("");
const error = ref("");
const assets = ref([]);
const fileRef = ref(null);
const dragCounter = ref(0);
const dragActive = ref(false);

const extracting = ref(false);
const selectedAsset = ref(null);
const selectedCard = ref(null);
const selectedCardError = ref("");
const selectedImageDim = ref({ w: null, h: null });

function setMsg({ nextStatus, nextError }) {
  status.value = String(nextStatus || "");
  error.value = String(nextError || "");
}

function formatSize(n) {
  const size = Number(n || 0);
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function buildMarkdown(a) {
  const name = String(a?.name || a?.id || "asset").replaceAll("]", "");
  const url = String(a?.url || "");
  return `![${name}](${url})`;
}

function pickCardData(card) {
  const root = card && typeof card === "object" ? card : {};
  const data = root && typeof root.data === "object" && root.data ? root.data : root;
  const spec = String(root.spec || (root.data ? "chara_card_v3" : "unknown"));
  const specVersion = String(root.spec_version || "");
  return { spec, specVersion, data };
}

function oneLine(text, maxLen) {
  const s = String(text || "").trim().replaceAll("\r", "");
  const line = (s.split("\n")[0] || "").trim();
  if (!line) return "（空）";
  return line.length > maxLen ? `${line.slice(0, maxLen)}…` : line;
}

const selectedCardInfoText = computed(() => {
  if (!selectedCard.value) return "";
  const { spec, specVersion, data } = pickCardData(selectedCard.value);
  const name = String(data?.name || "（未命名）").trim() || "（未命名）";
  const tags = Array.isArray(data?.tags) ? data.tags.filter(Boolean) : [];
  const wbEntries = Array.isArray(data?.character_book?.entries) ? data.character_book.entries.length : 0;
  const regexScripts = Array.isArray(data?.extensions?.regex_scripts) ? data.extensions.regex_scripts.length : 0;
  const hasTavernHelper = Boolean(data?.extensions?.tavern_helper);
  const lines = [
    `spec: ${spec}${specVersion ? ` (${specVersion})` : ""}`,
    `name: ${name}`,
    tags.length ? `tags: ${tags.join(" / ")}` : "tags: （无）",
    `description: ${oneLine(data?.description, 80)}`,
    `first_mes: ${oneLine(data?.first_mes, 80)}`,
    `worldbook.entries: ${wbEntries}`,
    `extensions.regex_scripts: ${regexScripts}`,
    `extensions.tavern_helper: ${hasTavernHelper ? "有" : "无"}`,
  ];
  return lines.join("\n");
});

async function copyText(text) {
  setMsg({ nextStatus: "", nextError: "" });
  const t = String(text || "");
  if (!t) return;
  try {
    if (!navigator?.clipboard?.writeText) throw new Error("浏览器不支持 clipboard.writeText。");
    await navigator.clipboard.writeText(t);
    setMsg({ nextStatus: "已复制。" });
  } catch (err) {
    setMsg({ nextError: `复制失败：${String(err?.message || err)}` });
  }
}

async function extractCardFromAssetId(id) {
  const res = await fetch(`/api/vcard/assets/extract/${encodeURIComponent(String(id || ""))}`);
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw new Error(json?.error || `${res.status} ${res.statusText}`);
  return json.card;
}

async function selectAsset(a) {
  selectedAsset.value = a || null;
  selectedCard.value = null;
  selectedCardError.value = "";
  selectedImageDim.value = { w: null, h: null };
  if (!a) return;
  const mime = String(a?.mime || "");
  if (mime !== "image/png") return (selectedCardError.value = "该文件不是 PNG（无法解析角色卡元数据）。");

  extracting.value = true;
  try {
    selectedCard.value = await extractCardFromAssetId(a.id);
  } catch (err) {
    selectedCardError.value = `解析失败：${String(err?.message || err)}`;
  } finally {
    extracting.value = false;
  }
}

function onSelectedImageLoad(e) {
  const w = Number(e?.target?.naturalWidth || 0);
  const h = Number(e?.target?.naturalHeight || 0);
  if (w > 0 && h > 0) selectedImageDim.value = { w, h };
}

const selectedImageDimText = computed(() => {
  const w = Number(selectedImageDim.value?.w || 0);
  const h = Number(selectedImageDim.value?.h || 0);
  if (!(w > 0 && h > 0)) return "";
  return ` · ${w}×${h}`;
});

async function copyCardJson() {
  if (!selectedCard.value) return;
  await copyText(JSON.stringify(selectedCard.value, null, 2));
}

async function loadSelectedCard() {
  setMsg({ nextStatus: "", nextError: "" });
  if (!selectedCard.value) return;
  if (typeof props.importCharaCardJson !== "function") return setMsg({ nextError: "当前页面未绑定 importCharaCardJson（无法加载）。" });
  try {
    await props.importCharaCardJson(selectedCard.value);
    setMsg({ nextStatus: "已加载为当前角色卡。" });
  } catch (err) {
    setMsg({ nextError: `加载失败：${String(err?.message || err)}` });
  }
}

async function refresh() {
  setMsg({ nextStatus: "", nextError: "" });
  busy.value = true;
  try {
    const res = await fetch("/api/vcard/assets/list");
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) throw new Error(json?.error || `${res.status} ${res.statusText}`);
    assets.value = Array.isArray(json.assets) ? json.assets : [];
    if (selectedAsset.value?.id) {
      const found = assets.value.find((x) => String(x?.id || "") === String(selectedAsset.value?.id || ""));
      selectedAsset.value = found || null;
      if (!found) {
        selectedCard.value = null;
        selectedCardError.value = "";
      }
    }
  } catch (err) {
    setMsg({ nextError: `刷新失败：${String(err?.message || err)}` });
  } finally {
    busy.value = false;
  }
}

async function uploadOne(file) {
  const fd = new FormData();
  fd.append("file", file, file.name);
  const res = await fetch("/api/vcard/assets/upload", { method: "POST", body: fd });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw new Error(json?.error || `${res.status} ${res.statusText}`);
  return json.asset;
}

async function onPickFiles(e) {
  const list = Array.from(e?.target?.files || []);
  e.target.value = "";
  if (list.length === 0) return;
  await uploadFiles(list);
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

async function onDrop(e) {
  if (!hasFileDrag(e)) return;
  e.preventDefault();
  dragCounter.value = 0;
  dragActive.value = false;
  const list = Array.from(e?.dataTransfer?.files || []).filter((f) => String(f?.type || "").startsWith("image/"));
  if (list.length === 0) return setMsg({ nextError: "拖拽文件必须为图片格式。" });
  await uploadFiles(list);
}

async function uploadFiles(list) {
  setMsg({ nextStatus: "", nextError: "" });
  if (!Array.isArray(list) || list.length === 0) return;

  busy.value = true;
  try {
    let okCount = 0;
    for (const f of list) {
      if (!String(f?.type || "").startsWith("image/")) continue;
      try {
        await uploadOne(f);
        okCount += 1;
      } catch (err) {
        setMsg({ nextError: `上传失败：${String(err?.message || err)}` });
        break;
      }
    }
    if (okCount > 0) setMsg({ nextStatus: `已上传 ${okCount} 个资源。` });
    await refresh();
  } finally {
    busy.value = false;
  }
}

async function removeAsset(a) {
  setMsg({ nextStatus: "", nextError: "" });
  const id = String(a?.id || "");
  if (!id) return;
  if (!confirm(`确定删除该资源吗？\n\n- ${String(a?.name || id)}`)) return;

  busy.value = true;
  try {
    const res = await fetch(`/api/vcard/assets/${encodeURIComponent(id)}`, { method: "DELETE" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) throw new Error(json?.error || `${res.status} ${res.statusText}`);
    setMsg({ nextStatus: "已删除资源。" });
    if (selectedAsset.value?.id === id) {
      selectedAsset.value = null;
      selectedCard.value = null;
      selectedCardError.value = "";
    }
    await refresh();
  } catch (err) {
    setMsg({ nextError: `删除失败：${String(err?.message || err)}` });
  } finally {
    busy.value = false;
  }
}

onMounted(() => refresh());
</script>
