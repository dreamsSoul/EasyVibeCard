/**
 * 文件：patchOps.js
 * 模块：server/entities
 * 作用：patchOps 对外入口（拆分实现，保持 import 路径稳定）
 * 依赖：server/entities/patchOps/*
 * @created 2026-01-07
 * @modified 2026-01-07
 */

export { applyPatchOps } from "./patchOps/index.js";

