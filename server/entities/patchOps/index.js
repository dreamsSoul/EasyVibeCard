/**
 * 文件：index.js
 * 模块：server/entities/patchOps
 * 作用：applyPatchOps 主流程（校验 + 应用 + changedPaths）
 * 依赖：server/shared/apiError、server/shared/errorCodes、path、validators、mutations
 * @created 2026-01-07
 * @modified 2026-01-07
 */

import { ApiError } from "../../shared/apiError.js";
import { ERROR_CODES } from "../../shared/errorCodes.js";

import { extractRootKey } from "./path.js";
import { removeBySegments, setBySegments } from "./mutations.js";
import {
  ensureCardPathAllowed,
  ensureRawPathAllowed,
  ensureRemovePathAllowed,
  ensureRootAllowed,
  normalizePatchOp,
} from "./validators.js";

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function assertNonEmptyOps(patchOps) {
  const ops = Array.isArray(patchOps) ? patchOps : null;
  if (ops && ops.length > 0) return ops;
  throw new ApiError({ httpStatus: 400, code: ERROR_CODES.BAD_REQUEST, message: "patchOps 不能为空。" });
}

function applyRawOp(next, op) {
  const key = String(op.segments[2]?.key || "");
  if (!isPlainObject(next.raw)) next.raw = {};
  if (!isPlainObject(next.raw.dataExtensions)) next.raw.dataExtensions = {};
  if (op.type === "set") next.raw.dataExtensions[key] = op.value;
  else delete next.raw.dataExtensions[key];
}

function assertSetHasValue(op, opIndex) {
  if (op.type !== "set") return;
  if (op.hasValue) return;
  throw new ApiError({
    httpStatus: 400,
    code: ERROR_CODES.PATCH_OP_INVALID,
    message: "set 缺少 value。",
    details: { opIndex, path: op.path },
  });
}

function applyOneOp({ next, rawOp, opIndex }) {
  const rootKey = extractRootKey(rawOp.segments);
  ensureRootAllowed(rootKey, opIndex);
  assertSetHasValue(rawOp, opIndex);

  if (rootKey === "card") ensureCardPathAllowed(next, rawOp.segments, opIndex, rawOp.path);
  if (rootKey === "raw") ensureRawPathAllowed(rawOp.segments, opIndex, rawOp.path);
  if (rawOp.type === "remove") ensureRemovePathAllowed(rootKey, rawOp.segments, opIndex, rawOp.path);

  if (rootKey === "raw") applyRawOp(next, rawOp);
  else if (rawOp.type === "set") setBySegments({ root: next, segments: rawOp.segments, value: rawOp.value, opIndex, rawPath: rawOp.path });
  else removeBySegments({ root: next, segments: rawOp.segments, opIndex, rawPath: rawOp.path });
}

function assertNoMixedVibePlanAndArtifacts(rawOps) {
  let hasRaw = false;
  let hasNonRaw = false;

  for (const op of Array.isArray(rawOps) ? rawOps : []) {
    const rootKey = extractRootKey(op?.segments);
    if (rootKey === "raw") hasRaw = true;
    else hasNonRaw = true;
  }

  if (!hasRaw || !hasNonRaw) return;
  throw new ApiError({
    httpStatus: 400,
    code: ERROR_CODES.MODE_FORBIDDEN,
    message: "不允许同时修改 raw.dataExtensions.vibePlan 与其他字段：请拆成两次提交。",
    details: {},
  });
}

/**
 * 中文注释：
 * applyPatchOps({ snapshot, patchOps, mode })
 * 作用：在内存中应用 patchOps，返回新 snapshot 与 changedPaths
 * 约束：遵守 root 白名单；raw 仅允许 raw.dataExtensions.vibePlan；禁止与其他根路径混合修改
 * 参数：
 *  - snapshot: object（当前草稿快照）
 *  - patchOps: Array<{ op, path, value? }>
 *  - mode: any（已废弃；忽略）
 * 返回：{ mode: "auto", snapshot: object, changedPaths: string[] }
 */
export function applyPatchOps({ snapshot, patchOps, mode }) {
  const ops = assertNonEmptyOps(patchOps);
  void mode;

  const next = structuredClone(snapshot);
  const changedPaths = new Set();

  const rawOps = ops.map((op, i) => normalizePatchOp(op, i));
  assertNoMixedVibePlanAndArtifacts(rawOps);

  for (let i = 0; i < rawOps.length; i++) {
    const rawOp = rawOps[i];
    applyOneOp({ next, rawOp, opIndex: i });
    changedPaths.add(rawOp.path);
  }

  return { mode: "auto", snapshot: next, changedPaths: Array.from(changedPaths) };
}
