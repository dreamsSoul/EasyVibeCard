<!--
文件：VCardImportExport.vue
模块：角色卡设计器
作用：导入/导出（JSON/PNG）
依赖：后端 /api/vcard/png/*
@created 2025-12-29
@modified 2025-12-31
-->

<template>
  <details class="vcardEditor" open>
    <summary class="vcardEditor__summary">导入 / 导出</summary>

    <div class="formRow">
      <div class="formLabel">导出口径</div>
      <div class="formCtrl">
        <select v-model="modeModel" class="input input--sm" :disabled="busy">
          <option value="publish">发布稿（不含任务进度）</option>
          <option value="work">工作稿（含任务进度）</option>
        </select>
        <div class="hint">说明：发布稿会过滤 <code>data.extensions.vibePlan</code>（任务进度/工作流元数据），其余 extensions 原样保留。</div>
      </div>
    </div>

    <div class="inline" style="margin-top: 10px">
      <button class="btn" :disabled="busy" @click="jsonFileRef?.click()">导入 JSON 文件</button>
      <button class="btn" :disabled="busy" @click="downloadJson">导出 JSON</button>
      <input ref="jsonFileRef" type="file" accept="application/json,.json" style="display: none" @change="onImportJsonFile" />
    </div>

    <div class="inline" style="margin-top: 10px">
      <button class="btn" :disabled="busy" @click="pngImportRef?.click()">导入 PNG</button>
      <button class="btn" :disabled="busy" @click="pngBaseRef?.click()">导出 PNG（选择底图）</button>
      <input ref="pngImportRef" type="file" accept="image/png" style="display: none" @change="onImportPng" />
      <input ref="pngBaseRef" type="file" accept="image/png" style="display: none" @change="onExportPng" />
    </div>

    <div class="formRow">
      <div class="formLabel">粘贴 JSON</div>
      <div class="formCtrl">
        <textarea v-model="jsonText" class="input" rows="5" placeholder="粘贴 chara_card_v2/v3 JSON，然后点击导入"></textarea>
        <div class="inline" style="margin-top: 8px">
          <button class="btn" :disabled="busy || !jsonText.trim()" @click="onImportJsonText">从文本导入</button>
          <button class="btn" :disabled="busy || !jsonText.trim()" @click="jsonText = ''">清空</button>
        </div>
      </div>
    </div>

    <details class="vcardEditor" style="margin-top: 10px" open>
      <summary class="vcardEditor__summary">实时导出预览（{{ modeLabel }} / chara_card_v3）</summary>
      <div class="inline" style="margin-top: 10px">
        <button class="btn" :disabled="busy || !exportPreview.ok" @click="copyExportJson">复制 JSON</button>
        <button class="btn" :disabled="busy || !exportPreview.ok" @click="copyExportJsonMin">复制（压缩）</button>
      </div>
      <pre class="code" style="max-height: 240px">{{ exportPreview.ok ? exportPreview.json : exportPreview.error }}</pre>
    </details>

    <div class="hint" v-if="status">{{ status }}</div>
    <div class="error" v-if="error">{{ error }}</div>
  </details>
</template>

<script setup>
import { computed, ref } from "vue";

const props = defineProps({
  importCharaCardJson: { type: Function, required: true },
  exportCharaCardJson: { type: Function, required: true },
  exportMode: { type: String, default: "publish" },
  setExportMode: { type: Function, default: null },
});

const busy = ref(false);
const error = ref("");
const status = ref("");
const jsonText = ref("");

const jsonFileRef = ref(null);
const pngImportRef = ref(null);
const pngBaseRef = ref(null);

const modeModel = computed({
  get: () => (String(props.exportMode || "") === "work" ? "work" : "publish"),
  set: (v) => (typeof props.setExportMode === "function" ? props.setExportMode(v) : null),
});

const modeLabel = computed(() => (modeModel.value === "work" ? "工作稿" : "发布稿"));

const exportPreview = computed(() => {
  try {
    const card = props.exportCharaCardJson();
    return { ok: true, card, json: JSON.stringify(card, null, 2) };
  } catch (err) {
    return { ok: false, error: `（导出预览不可用）${String(err?.message || err)}` };
  }
});

function setMsg({ nextError, nextStatus }) {
  error.value = String(nextError || "");
  status.value = String(nextStatus || "");
}

async function copyText(text) {
  const t = String(text || "");
  if (!t) return false;
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(t);
    return true;
  }
  return false;
}

async function copyExportJson() {
  setMsg({ nextError: "", nextStatus: "" });
  if (!exportPreview.value.ok) return;
  try {
    const ok = await copyText(exportPreview.value.json);
    if (!ok) throw new Error("浏览器不支持 clipboard.writeText。");
    setMsg({ nextStatus: "已复制 JSON。" });
  } catch (err) {
    setMsg({ nextError: `复制失败：${String(err?.message || err)}` });
  }
}

async function copyExportJsonMin() {
  setMsg({ nextError: "", nextStatus: "" });
  if (!exportPreview.value.ok) return;
  try {
    const min = JSON.stringify(exportPreview.value.card);
    const ok = await copyText(min);
    if (!ok) throw new Error("浏览器不支持 clipboard.writeText。");
    setMsg({ nextStatus: "已复制（压缩）JSON。" });
  } catch (err) {
    setMsg({ nextError: `复制失败：${String(err?.message || err)}` });
  }
}

async function onImportJsonFile(e) {
  setMsg({ nextError: "", nextStatus: "" });
  const file = e?.target?.files?.[0];
  e.target.value = "";
  if (!file) return;
  busy.value = true;
  try {
    const text = await file.text();
    const obj = JSON.parse(text);
    await props.importCharaCardJson(obj);
    setMsg({ nextStatus: `已导入：${file.name}` });
  } catch (err) {
    setMsg({ nextError: `导入失败：${String(err?.message || err)}` });
  } finally {
    busy.value = false;
  }
}

async function onImportJsonText() {
  setMsg({ nextError: "", nextStatus: "" });
  busy.value = true;
  try {
    const obj = JSON.parse(String(jsonText.value || ""));
    await props.importCharaCardJson(obj);
    setMsg({ nextStatus: "已从文本导入。" });
  } catch (err) {
    setMsg({ nextError: `导入失败：${String(err?.message || err)}` });
  } finally {
    busy.value = false;
  }
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadJson() {
  setMsg({ nextError: "", nextStatus: "" });
  try {
    const card = props.exportCharaCardJson();
    const name = String(card?.data?.name || "card").trim() || "card";
    const blob = new Blob([JSON.stringify(card, null, 2)], { type: "application/json" });
    downloadBlob(blob, `${name}.chara_card_v3.json`);
    setMsg({ nextStatus: "已导出 JSON。" });
  } catch (err) {
    setMsg({ nextError: `导出失败：${String(err?.message || err)}` });
  }
}

async function onImportPng(e) {
  setMsg({ nextError: "", nextStatus: "" });
  const file = e?.target?.files?.[0];
  e.target.value = "";
  if (!file) return;
  busy.value = true;
  try {
    const fd = new FormData();
    fd.append("png", file, file.name);
    const res = await fetch("/api/vcard/png/extract", { method: "POST", body: fd });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) throw new Error(json?.error || `${res.status} ${res.statusText}`);
    await props.importCharaCardJson(json.card);
    setMsg({ nextStatus: `已导入 PNG：${file.name}` });
  } catch (err) {
    setMsg({ nextError: `导入 PNG 失败：${String(err?.message || err)}` });
  } finally {
    busy.value = false;
  }
}

async function onExportPng(e) {
  setMsg({ nextError: "", nextStatus: "" });
  const file = e?.target?.files?.[0];
  e.target.value = "";
  if (!file) return;
  busy.value = true;
  try {
    const card = props.exportCharaCardJson();
    const name = String(card?.data?.name || "card").trim() || "card";
    const fd = new FormData();
    fd.append("png", file, file.name);
    fd.append("cardJson", JSON.stringify(card));
    const res = await fetch("/api/vcard/png/embed", { method: "POST", body: fd });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      throw new Error(json?.error || `${res.status} ${res.statusText}`);
    }
    const blob = await res.blob();
    downloadBlob(blob, `${name}.png`);
    setMsg({ nextStatus: "已导出 PNG。" });
  } catch (err) {
    setMsg({ nextError: `导出 PNG 失败：${String(err?.message || err)}` });
  } finally {
    busy.value = false;
  }
}
</script>
