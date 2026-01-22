/**
 * 文件：server/index.js
 * 模块：单端口 Web 服务
 * 作用：同一端口同时提供：前端页面 + /api（聊天代理 + vcard）
 * 依赖：express、cors、vite（dev 模式）
 * @created 2025-12-28
 * @modified 2026-01-01
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import cors from "cors";
import express from "express";

import { initAppDb } from "./frameworks/database/sqlite/initAppDb.js";
import { attachApiV1Routes } from "./frameworks/web/apiV1/routes.js";
import { attachChatCompletionsRoutes } from "./routes/chatCompletions.js";
import { attachVcardRoutes } from "./vcard/routes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function isProdMode() {
  return process.argv.includes("--prod") || process.env.NODE_ENV === "production";
}

function getPort() {
  const raw = Number(process.env.PORT || 5173);
  return Number.isFinite(raw) ? raw : 5173;
}

function createApp() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  const corsOrigin = process.env.CORS_ORIGIN || "*";
  app.use("/api", cors({ origin: corsOrigin === "*" ? "*" : corsOrigin.split(",").map((x) => x.trim()) }));

  attachChatCompletionsRoutes(app);
  attachVcardRoutes(app);

  return { app, corsOrigin };
}

async function attachDevMiddleware(app) {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    root: projectRoot,
    server: { middlewareMode: true },
    appType: "custom",
  });
  app.use(vite.middlewares);

  app.get("*", async (req, res, next) => {
    try {
      if (req.originalUrl.startsWith("/api")) return next();
      const templatePath = path.join(projectRoot, "index.html");
      const raw = await fs.readFile(templatePath, "utf-8");
      const html = await vite.transformIndexHtml(req.originalUrl, raw);
      res.status(200).set({ "Content-Type": "text/html" }).end(html);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}

function attachProdMiddleware(app) {
  const distDir = path.join(projectRoot, "dist");
  app.use(express.static(distDir));
  app.get("*", async (_req, res) => res.sendFile(path.join(distDir, "index.html")));
}

function listen(app, corsOrigin) {
  const port = getPort();
  const prod = isProdMode();

  app.listen(port, () => {
    const mode = prod ? "production" : "development";
    console.log(`[server] ${mode} listening on http://localhost:${port}`);
    console.log(`[server] cors origin: ${corsOrigin}`);
  });
}

async function main() {
  const { app, corsOrigin } = createApp();
  const { db, migrated } = await initAppDb({ projectRoot });
  attachApiV1Routes(app, { db, migrated });

  const closeDb = async () => {
    await db.close().catch(() => undefined);
  };
  process.on("SIGINT", () => closeDb().finally(() => process.exit(0)));
  process.on("SIGTERM", () => closeDb().finally(() => process.exit(0)));

  if (isProdMode()) attachProdMiddleware(app);
  else await attachDevMiddleware(app);
  listen(app, corsOrigin);
}

main().catch((err) => {
  console.error("[server] failed to start:", err);
  process.exit(1);
});
