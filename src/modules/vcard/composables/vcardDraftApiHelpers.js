/**
 * 文件：vcardDraftApiHelpers.js
 * 模块：角色卡设计器
 * 作用：VCard Draft API 前端侧通用工具（apply-items 构建、时间格式化、lastApply 记录）
 * 依赖：shared/utils/time、vcard/domain
 * @created 2026-01-11
 * @modified 2026-01-11
 */

import { nowTime } from "../../../shared";
import { buildVcardApplyPreview } from "../domain/applyPreview";
import { draftArtifactDiff } from "../domain/draftArtifactDiff";

export function normalizeText(value) {
  return String(value ?? "").trim();
}

export function toTimeLabel(iso) {
  const d = new Date(String(iso || ""));
  if (!Number.isFinite(d.getTime())) return nowTime();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function buildCardPatchOps(card) {
  const c = card && typeof card === "object" ? card : {};
  return Object.keys(c).map((k) => ({ op: "set", path: `card.${k}`, value: c[k] }));
}

export function buildApplyItemsFromDraft(snapshot) {
  const d = snapshot && typeof snapshot === "object" ? snapshot : {};
  return [
    { kind: "card.patch", patch: buildCardPatchOps(d.card) },
    { kind: "worldbook.target", worldbook: d.worldbook || { name: "", entries: [] } },
    { kind: "regex_scripts.set", regex_scripts: Array.isArray(d.regex_scripts) ? d.regex_scripts : [] },
    { kind: "client_scripts.set", tavern_helper: d.tavern_helper || { scripts: [], variables: {} } },
  ];
}

export function isArtifactPath(path) {
  const root = String(path || "").split(".")[0] || "";
  return root === "card" || root === "worldbook" || root === "regex_scripts" || root === "tavern_helper";
}

export function recordApplyResult({ lastApplyRef, beforeDraft, afterDraft, kinds, changedPaths }) {
  const diff = draftArtifactDiff(beforeDraft, afterDraft);
  const preview = buildVcardApplyPreview({ beforeDraft, afterDraft, changedPaths: diff.changedPaths });
  const lintWarnings = Array.isArray(afterDraft?.validation?.warnings) ? afterDraft.validation.warnings : [];

  lastApplyRef.value = {
    warnings: lintWarnings,
    appliedAt: nowTime(),
    kinds: Array.isArray(kinds) ? kinds : [],
    artifactChanged: diff.artifactChanged,
    changedPaths: Array.isArray(changedPaths) && changedPaths.length ? changedPaths : diff.changedPaths,
    preview,
  };
}

