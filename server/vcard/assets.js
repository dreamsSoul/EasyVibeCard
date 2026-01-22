/**
 * 文件：assets.js
 * 模块：vcard
 * 作用：资源管理器（图片上传/列表/读取/删除）的文件存储
 * 依赖：fs/promises、path、crypto
 * @created 2025-12-29
 * @modified 2025-12-29
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ASSETS_DIR = path.join(__dirname, "_assets_store");

function nowIso() {
  return new Date().toISOString();
}

function sanitizeId(id) {
  const raw = String(id || "").trim();
  return /^[a-zA-Z0-9_-]{8,80}$/.test(raw) ? raw : "";
}

function pickExt({ originalName, mime }) {
  const ext = path.extname(String(originalName || "")).toLowerCase();
  if (ext && ext.length <= 10) return ext;
  const m = String(mime || "").toLowerCase();
  if (m === "image/png") return ".png";
  if (m === "image/jpeg") return ".jpg";
  if (m === "image/webp") return ".webp";
  if (m === "image/gif") return ".gif";
  if (m === "image/svg+xml") return ".svg";
  return "";
}

async function ensureAssetsDir() {
  await fs.mkdir(ASSETS_DIR, { recursive: true });
}

function metaPath(id) {
  return path.join(ASSETS_DIR, `${id}.meta.json`);
}

async function readMeta(id) {
  const raw = await fs.readFile(metaPath(id), "utf-8");
  return JSON.parse(raw);
}

async function safeUnlink(filePath) {
  try {
    await fs.unlink(filePath);
  } catch {
    return;
  }
}

export async function listVcardAssets() {
  await ensureAssetsDir();
  const names = await fs.readdir(ASSETS_DIR).catch(() => []);
  const metas = [];
  for (const name of names) {
    if (!String(name).endsWith(".meta.json")) continue;
    try {
      const json = JSON.parse(await fs.readFile(path.join(ASSETS_DIR, name), "utf-8"));
      if (!json || typeof json !== "object") continue;
      if (!sanitizeId(json.id)) continue;
      metas.push(json);
    } catch {
      continue;
    }
  }
  metas.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return metas;
}

export async function saveVcardAsset({ buffer, originalName, mime, size }) {
  await ensureAssetsDir();
  const id = crypto.randomUUID ? crypto.randomUUID() : `asset_${Date.now()}_${Math.trunc(Math.random() * 100000)}`;
  const safeId = sanitizeId(id);
  if (!safeId) throw new Error("生成资源 id 失败。");

  const ext = pickExt({ originalName, mime });
  if (!ext) throw new Error("不支持的图片类型（无法确定扩展名）。");

  const fileName = `${safeId}${ext}`;
  const filePath = path.join(ASSETS_DIR, fileName);

  await fs.writeFile(filePath, buffer);

  const meta = {
    id: safeId,
    fileName,
    name: String(originalName || fileName),
    mime: String(mime || "application/octet-stream"),
    size: Number.isFinite(Number(size)) ? Number(size) : buffer?.length || 0,
    createdAt: nowIso(),
  };
  await fs.writeFile(metaPath(safeId), JSON.stringify(meta, null, 2), "utf-8");
  return meta;
}

export async function deleteVcardAsset(id) {
  const safeId = sanitizeId(id);
  if (!safeId) throw new Error("资源 id 非法。");
  const meta = await readMeta(safeId);
  await safeUnlink(path.join(ASSETS_DIR, String(meta?.fileName || "")));
  await safeUnlink(metaPath(safeId));
}

export async function getVcardAssetFile(id) {
  const safeId = sanitizeId(id);
  if (!safeId) throw new Error("资源 id 非法。");
  const meta = await readMeta(safeId);
  const fileName = String(meta?.fileName || "");
  if (!fileName) throw new Error("资源元数据损坏：fileName 为空。");
  const filePath = path.join(ASSETS_DIR, fileName);
  return { meta, filePath };
}

