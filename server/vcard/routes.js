/**
 * 文件：routes.js
 * 模块：vcard
 * 作用：角色卡设计器后端路由：PNG 导入/导出
 * 依赖：express、multer、vcard/png
 * @created 2025-12-29
 * @modified 2025-12-29
 */

import fs from "node:fs/promises";
import multer from "multer";
import { embedCardJsonToPngBuffer, extractCardJsonFromPngBuffer } from "./png.js";
import { deleteVcardAsset, getVcardAssetFile, listVcardAssets, saveVcardAsset } from "./assets.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

function readCardJsonFromBody(req) {
  const raw = String(req?.body?.cardJson || "");
  if (!raw.trim()) throw new Error("缺少字段：cardJson");
  return JSON.parse(raw);
}

export function attachVcardRoutes(app) {
  app.get("/api/vcard/assets/list", async (_req, res) => {
    try {
      const assets = await listVcardAssets();
      const list = assets.map((a) => ({ ...a, url: `/api/vcard/assets/file/${a.id}` }));
      return res.json({ ok: true, assets: list });
    } catch (err) {
      return res.status(400).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.post("/api/vcard/assets/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file?.buffer) return res.status(400).json({ ok: false, error: "缺少文件字段：file" });
      const mime = String(req.file.mimetype || "");
      if (!mime.startsWith("image/")) return res.status(400).json({ ok: false, error: "仅支持上传图片（image/*）。" });
      const meta = await saveVcardAsset({
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        mime: req.file.mimetype,
        size: req.file.size,
      });
      return res.json({ ok: true, asset: { ...meta, url: `/api/vcard/assets/file/${meta.id}` } });
    } catch (err) {
      return res.status(400).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.get("/api/vcard/assets/file/:id", async (req, res) => {
    try {
      const { meta, filePath } = await getVcardAssetFile(req.params.id);
      res.setHeader("Content-Type", String(meta?.mime || "application/octet-stream"));
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.sendFile(filePath);
    } catch (err) {
      return res.status(404).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.get("/api/vcard/assets/extract/:id", async (req, res) => {
    try {
      const { meta, filePath } = await getVcardAssetFile(req.params.id);
      if (String(meta?.mime || "") !== "image/png") return res.status(400).json({ ok: false, error: "仅支持 PNG 角色卡解析。" });
      const buf = await fs.readFile(filePath);
      const card = extractCardJsonFromPngBuffer(buf);
      return res.json({ ok: true, card });
    } catch (err) {
      return res.status(400).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.delete("/api/vcard/assets/:id", async (req, res) => {
    try {
      await deleteVcardAsset(req.params.id);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(400).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.post("/api/vcard/png/extract", upload.single("png"), (req, res) => {
    try {
      if (!req.file?.buffer) return res.status(400).json({ ok: false, error: "缺少文件字段：png" });
      const card = extractCardJsonFromPngBuffer(req.file.buffer);
      return res.json({ ok: true, card });
    } catch (err) {
      return res.status(400).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.post("/api/vcard/png/embed", upload.single("png"), (req, res) => {
    try {
      if (!req.file?.buffer) return res.status(400).json({ ok: false, error: "缺少文件字段：png" });
      const card = readCardJsonFromBody(req);
      const out = embedCardJsonToPngBuffer(req.file.buffer, card);
      res.setHeader("Content-Type", "image/png");
      return res.send(out);
    } catch (err) {
      return res.status(400).json({ ok: false, error: String(err?.message || err) });
    }
  });
}
