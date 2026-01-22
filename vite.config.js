/**
 * 文件：vite.config.js
 * 模块：前端构建
 * 作用：Vite + Vue3 配置（用于 build；dev 走单端口中间件模式）
 * 依赖：vite、@vitejs/plugin-vue
 * @created 2025-12-28
 * @modified 2025-12-28
 */

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});

