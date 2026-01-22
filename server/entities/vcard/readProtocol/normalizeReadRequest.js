/**
 * 文件：normalizeReadRequest.js
 * 模块：server/entities/vcard/readProtocol
 * 作用：归一化 kind=read（限制 reads 数量/offset/limit）
 * 依赖：constants、utils
 * @created 2026-01-08
 * @modified 2026-01-08
 */

import { DEFAULT_LIMIT, MAX_LIMIT, MAX_READS } from "./constants.js";
import { clampInt, isPlainObject, normalizeReadPath } from "./utils.js";

function normalizeOneRead(raw) {
  const obj = isPlainObject(raw) ? raw : {};
  const path = normalizeReadPath(obj.path);
  if (!path) return { ok: false, error: "read.path 不能为空。" };
  const offset = clampInt(obj.offset, { min: 0, max: Number.MAX_SAFE_INTEGER, fallback: 0 });
  const limit = clampInt(obj.limit, { min: 1, max: MAX_LIMIT, fallback: DEFAULT_LIMIT });
  return { ok: true, read: { path, offset, limit } };
}

/**
 * 中文注释：
 * normalizeReadRequest(item)
 * 作用：归一化 kind=read 输出（限制数量/offset/limit）
 * 约束：只支持 reads[]；每项必须含 path；limit 上限 MAX_LIMIT
 * 参数：
 *  - item: object（模型输出对象）
 * 返回：{ ok:boolean, reads?:{path:string,offset:number,limit:number}[], error?:string }
 */
export function normalizeReadRequest(item) {
  const obj = isPlainObject(item) ? item : null;
  if (!obj || String(obj.kind || "") !== "read") return { ok: false, error: "不是 read 请求。" };

  const readsRaw = Array.isArray(obj.reads) ? obj.reads : [];
  if (readsRaw.length === 0) return { ok: false, error: "read.reads 不能为空。" };
  if (readsRaw.length > MAX_READS) return { ok: false, error: `read.reads 过多（${readsRaw.length} > ${MAX_READS}）。` };

  const reads = [];
  for (const r of readsRaw) {
    const normalized = normalizeOneRead(r);
    if (!normalized.ok) return { ok: false, error: normalized.error };
    reads.push(normalized.read);
  }
  return { ok: true, reads };
}

