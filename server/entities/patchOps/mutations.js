/**
 * 文件：mutations.js
 * 模块：server/entities/patchOps
 * 作用：根据 segments 执行 set/remove（非 raw 路径）
 * 依赖：server/shared/apiError、server/shared/errorCodes
 * @created 2026-01-07
 * @modified 2026-01-21
 */

import { ApiError } from "../../shared/apiError.js";
import { ERROR_CODES } from "../../shared/errorCodes.js";

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function pickContainerForNextSeg(nextSeg) {
  // 注意：本项目的 path 语法中，数组索引属于“key[index]”，数组本身总是挂在对象字段上；
  // 因此向下遍历时，中间节点一律应为对象（由下一段 key 承载数组/对象）。
  return {};
}

function failPath(opIndex, rawPath, message) {
  throw new ApiError({
    httpStatus: 400,
    code: ERROR_CODES.PATCH_PATH_INVALID,
    message,
    details: { opIndex, path: rawPath },
  });
}

function ensurePlainObjectOrThrow(value, opIndex, rawPath, message) {
  if (isPlainObject(value)) return;
  failPath(opIndex, rawPath, message);
}

function ensureArrayIndexWritable(arr, index, opIndex, rawPath) {
  if (!Number.isFinite(index) || index < 0) failPath(opIndex, rawPath, "数组索引非法。");
  if (index > arr.length) failPath(opIndex, rawPath, `数组索引跳跃（index=${index}, length=${arr.length}）。`);
}

function setObjectSeg({ current, seg, nextSeg, isLast, value, opIndex, rawPath }) {
  ensurePlainObjectOrThrow(current, opIndex, rawPath, "目标不是对象，无法 set。");

  if (isLast) {
    current[seg.key] = value;
    return null;
  }

  const base = current[seg.key];
  if (!isPlainObject(base)) current[seg.key] = pickContainerForNextSeg(nextSeg);
  return current[seg.key];
}

function ensureArrayAtKey(current, key, opIndex, rawPath) {
  ensurePlainObjectOrThrow(current, opIndex, rawPath, "目标不是对象，无法 set 数组段。");
  if (!Array.isArray(current[key])) current[key] = [];
  return current[key];
}

function setArraySeg({ current, seg, nextSeg, isLast, value, opIndex, rawPath }) {
  const arr = ensureArrayAtKey(current, seg.key, opIndex, rawPath);
  ensureArrayIndexWritable(arr, seg.index, opIndex, rawPath);

  if (isLast) {
    if (seg.index === arr.length) arr.push(value);
    else arr[seg.index] = value;
    return null;
  }

  if (seg.index === arr.length) arr.push(pickContainerForNextSeg(nextSeg));
  if (!isPlainObject(arr[seg.index])) arr[seg.index] = pickContainerForNextSeg(nextSeg);
  return arr[seg.index];
}

export function setBySegments({ root, segments, value, opIndex, rawPath }) {
  let current = root;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg?.key) failPath(opIndex, rawPath, "path 解析失败。");

    const isLast = i === segments.length - 1;
    const nextSeg = segments[i + 1];

    const next =
      seg.index === null
        ? setObjectSeg({ current, seg, nextSeg, isLast, value, opIndex, rawPath })
        : setArraySeg({ current, seg, nextSeg, isLast, value, opIndex, rawPath });

    if (isLast) return;
    current = next;
  }
}

export function removeBySegments({ root, segments, opIndex, rawPath }) {
  if (!segments.length) return;
  if (segments.length === 1) {
    const seg = segments[0];
    if (!seg?.key || seg?.index === null) failPath(opIndex, rawPath, "remove 需要更具体的 path。");
    ensurePlainObjectOrThrow(root, opIndex, rawPath, "目标不是对象，无法 remove。");
    const arr = root[seg.key];
    if (!Array.isArray(arr)) return;
    if (seg.index < 0 || seg.index >= arr.length) return;
    arr.splice(seg.index, 1);
    return;
  }

  let current = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (!seg?.key) return;

    if (seg.index === null) {
      if (!isPlainObject(current)) return;
      current = current[seg.key];
      continue;
    }

    if (!isPlainObject(current)) return;
    const arr = current[seg.key];
    if (!Array.isArray(arr)) return;
    if (seg.index < 0 || seg.index >= arr.length) return;
    current = arr[seg.index];
  }

  const leaf = segments[segments.length - 1];
  if (!leaf?.key) return;
  if (!isPlainObject(current)) return;

  if (leaf.index === null) {
    delete current[leaf.key];
    return;
  }

  const arr = current[leaf.key];
  if (!Array.isArray(arr)) return;
  if (leaf.index < 0 || leaf.index >= arr.length) return;
  arr.splice(leaf.index, 1);
}
