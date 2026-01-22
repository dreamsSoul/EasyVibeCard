/**
 * 文件：patchOpsFromItems.js
 * 模块：server/use-cases/vcard/turn
 * 作用：把 vcard 输出 items 转为 canonical patchOps（供落库与 SSE patch_ops）
 * 依赖：server/entities/vcard、server/shared/apiError、server/shared/errorCodes、normalize
 * @created 2026-01-07
 * @modified 2026-01-08
 */

import { ApiError } from "../../../shared/apiError.js";
import { ERROR_CODES } from "../../../shared/errorCodes.js";

import { buildWorldbookPatchFromTarget } from "../../../entities/vcard/worldbookTarget.js";

import { normalizeText } from "./normalize.js";

function rootKeyFromPath(path) {
  const head = String(path || "").split(".")[0] || "";
  return head.replace(/\[.*?\]$/, "");
}

function pushPatchArrayInto(patchOps, rawPatch, allowedRoots) {
  const list = Array.isArray(rawPatch) ? rawPatch : [];
  for (const op of list) {
    const path = normalizeText(op?.path);
    const root = rootKeyFromPath(path);
    if (allowedRoots && !allowedRoots.has(root)) {
      throw new ApiError({
        httpStatus: 400,
        code: ERROR_CODES.PATCH_ROOT_FORBIDDEN,
        message: `patch 不允许修改 ${root || "（空）"}（收到：${path || "（空）"}）`,
        details: { path },
      });
    }
    patchOps.push(op);
  }
}

function kindAllowedRoots(kind) {
  if (kind === "card.patch") return new Set(["card", "raw"]);
  if (kind === "worldbook.patch") return new Set(["worldbook"]);
  if (kind === "regex_scripts.patch") return new Set(["regex_scripts"]);
  if (kind === "tavern_helper.patch") return new Set(["tavern_helper"]);
  return null;
}

function pushWorldbookTargetAsPatch(patchOps, { snapshot, item }) {
  const before = snapshot?.worldbook && typeof snapshot.worldbook === "object" ? snapshot.worldbook : { name: "", entries: [] };
  const res = buildWorldbookPatchFromTarget({ beforeWorldbook: before, targetWorldbook: item?.worldbook });
  if (!res?.ok) {
    throw new ApiError({
      httpStatus: 400,
      code: ERROR_CODES.BAD_REQUEST,
      message: res?.error || "worldbook.target 非法。",
      details: { stage: "build_patchops", kind: "worldbook.target" },
    });
  }
  pushPatchArrayInto(patchOps, res.patch, new Set(["worldbook"]));
}

function pushNonPatchKind(patchOps, { kind, snapshot, item }) {
  if (kind === "worldbook.target") pushWorldbookTargetAsPatch(patchOps, { snapshot, item });
  if (kind === "regex_scripts.set") patchOps.push({ op: "set", path: "regex_scripts", value: item.regex_scripts });
  if (kind === "client_scripts.set") patchOps.push({ op: "set", path: "tavern_helper", value: item.tavern_helper });
}

/**
 * 中文注释：
 * toPatchOpsFromItems(items)
 * 作用：把输出 items 转为 canonical patchOps（不做 apply，仅做转换与 kind->root 限制）
 * 约束：*.patch 需要 item.patch[]；worldbook.target 会被转换为 worldbook.patch（服务端生成 diff）
 * 参数：
 *  - items: object[]
 *  - snapshot: object（用于 worldbook.target -> patch diff）
 * 返回：{ kinds:string[], patchOps:any[] }
 */
export function toPatchOpsFromItems(items, snapshot) {
  const kinds = [];
  const patchOps = [];

  for (const item of Array.isArray(items) ? items : []) {
    const kind = normalizeText(item?.kind);
    if (!kind) continue;
    kinds.push(kind);

    if (kind.endsWith(".patch")) {
      pushPatchArrayInto(patchOps, item.patch, kindAllowedRoots(kind));
      continue;
    }

    pushNonPatchKind(patchOps, { kind, snapshot, item });
  }

  return { kinds, patchOps };
}
