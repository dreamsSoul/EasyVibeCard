/**
 * 文件：reviewPause.js
 * 模块：server/use-cases/vcard/turn
 * 作用：在 turn 生成阶段构建“审批型暂停”（plan_review / patch_review），返回 pending payload
 * 依赖：server/entities/patchOps、server/entities/vcard（vibePlan/applyPreview）
 * @created 2026-01-17
 * @modified 2026-01-17
 */

import { applyPatchOps } from "../../../entities/patchOps.js";
import { fingerprintDraftSnapshot } from "../../../entities/draftFingerprint.js";
import { buildVcardApplyPreview } from "../../../entities/vcard/applyPreview.js";
import { normalizeVibePlan, summarizeVibePlanIssues } from "../../../entities/vcard/vibePlan.js";

function nowIso() {
  return new Date().toISOString();
}

function toStringArray(value) {
  return (Array.isArray(value) ? value : [])
    .map((x) => String(x ?? "").trim())
    .filter((x) => x.length > 0);
}

function uniqStrings(list) {
  const out = [];
  const seen = new Set();
  for (const s of toStringArray(list)) {
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function rootKeyFromPath(path) {
  const head = String(path || "").split(".")[0] || "";
  return head.replace(/\[.*?\]$/, "");
}

function isArtifactPath(path) {
  const root = rootKeyFromPath(path);
  return root === "card" || root === "worldbook" || root === "regex_scripts" || root === "tavern_helper";
}

function hasArtifactChanged(changedPaths) {
  return (Array.isArray(changedPaths) ? changedPaths : []).some((p) => isArtifactPath(p));
}

function buildPendingPlan({ snapshotBefore, snapshotAfter, assistantWarnings }) {
  const rawPlan = snapshotAfter?.raw?.dataExtensions?.vibePlan ?? null;
  const normalized = rawPlan === null ? null : normalizeVibePlan(rawPlan);
  const issues = normalized ? summarizeVibePlanIssues(normalized) : { warnings: [] };
  const warnings = uniqStrings([...(assistantWarnings || []), ...(issues?.warnings || [])]);

  return {
    createdAt: nowIso(),
    fpBefore: fingerprintDraftSnapshot(snapshotBefore),
    plan: normalized,
    warnings,
  };
}

function buildPendingReview({ snapshotBefore, snapshotAfter, kinds, changedPaths, patchOps }) {
  return {
    createdAt: nowIso(),
    fpBefore: fingerprintDraftSnapshot(snapshotBefore),
    kinds: toStringArray(kinds),
    changedPaths: toStringArray(changedPaths),
    preview: buildVcardApplyPreview({ beforeDraft: snapshotBefore, afterDraft: snapshotAfter, changedPaths }),
    patchOps: Array.isArray(patchOps) ? patchOps : [],
  };
}

/**
 * 中文注释：
 * maybeBuildReviewPause({ source, snapshot, kinds, patchOps, assistantWarnings })
 * 作用：在 turn 中判断是否需要进入审批型暂停，并构建 pendingPlan/pendingReview
 * 约束：仅对 vcard-turn 生效（Run 暂不进入审批暂停）；必须先做 dry-run 校验 patchOps 可 apply
 * 参数：
 *  - source: "vcard-turn" | "vcard-run"
 *  - snapshot: object（baseVersion 快照）
 *  - kinds: string[]
 *  - patchOps: any[]
 *  - assistantWarnings: string[]
 * 返回：null | { pauseReason:'plan_review'|'patch_review', pendingPlan?:object, pendingReview?:object, proposedChangedPaths:string[] }
 */
export function maybeBuildReviewPause({ source, snapshot, kinds, patchOps, assistantWarnings }) {
  if (String(source || "") !== "vcard-turn") return null;

  const ops = Array.isArray(patchOps) ? patchOps : [];
  if (ops.length === 0) return null;

  // dry-run：复用 applyPatchOps 的校验，确保 pending 中的 patchOps 是可 apply 的。
  const dry = applyPatchOps({ snapshot, patchOps: ops, mode: "auto" });
  const proposedChangedPaths = toStringArray(dry?.changedPaths);

  const isVibePlanChange = proposedChangedPaths.includes("raw.dataExtensions.vibePlan");
  if (isVibePlanChange) {
    return {
      pauseReason: "plan_review",
      pendingPlan: buildPendingPlan({ snapshotBefore: snapshot, snapshotAfter: dry.snapshot, assistantWarnings }),
      proposedChangedPaths,
    };
  }

  // 全自动策略：产物变更（card/worldbook/regex/tavern_helper）不再进入 patch_review，
  // 直接 apply 并继续推进；仅保留 plan_review 作为“需要用户决策”的暂停点。
  // 说明：旧版本可能仍存在 patch_review pending；前端会在拉取到 pending 时自动 Accept。
  return null;
}
