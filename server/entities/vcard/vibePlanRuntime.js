/**
 * 文件：vibePlanRuntime.js
 * 模块：server/entities/vcard
 * 作用：VibePlan 运行时（服务端版）：仅在“模型输出应用成功后”推进
 * 依赖：vibePlan
 * @created 2026-01-11
 * @modified 2026-01-22
 */

import { advanceVibePlan, normalizeVibePlan, pickVibePlanCurrent } from "./vibePlan.js";

function nowIso() {
  return new Date().toISOString();
}

function syncCursor(plan) {
  const picked = pickVibePlanCurrent(plan);
  if (picked.type === "ok" || picked.type === "blocked") {
    if (String(plan.cursor?.currentTaskId || "") !== String(picked.taskId || "")) {
      plan.cursor.currentTaskId = String(picked.taskId || "");
      plan.updatedAt = nowIso();
      return true;
    }
    return false;
  }
  if (picked.type === "all_done") {
    if (String(plan.cursor?.currentTaskId || "")) {
      plan.cursor.currentTaskId = "";
      plan.updatedAt = nowIso();
      return true;
    }
  }
  return false;
}

function handleNoArtifactChange(plan, draft) {
  const synced = syncCursor(plan);
  if (synced) draft.raw.dataExtensions.vibePlan = plan;
  return { advanced: false, synced };
}

function handleArtifactChange(plan, draft, currentId, picked) {
  if (picked.type !== "ok" || !currentId) {
    const synced = syncCursor(plan);
    if (synced) draft.raw.dataExtensions.vibePlan = plan;
    return { advanced: false, synced };
  }

  const nextPlan = advanceVibePlan(plan, currentId);
  draft.raw.dataExtensions.vibePlan = nextPlan;
  return { advanced: true, from: currentId, to: String(nextPlan.cursor?.currentTaskId || ""), synced: true };
}

/**
 * 中文注释：
 * advanceVibePlanAfterAssistantApply({ draft, artifactChanged })
 * 作用：在“模型输出已成功应用”后推进 vibePlan（有产物变更就推进，否则仅同步 cursor）
 * 约束：只应在模型输出被成功应用后调用；不会在手动编辑（applyItems）时调用
 * 参数：
 *  - draft: object（CardDraft，会被原地更新 raw.dataExtensions.vibePlan）
 *  - artifactChanged: boolean（产物是否变化：card/worldbook/regex_scripts/tavern_helper）
 * 返回：{ advanced:boolean, from?:string, to?:string, synced?:boolean }
 */
export function advanceVibePlanAfterAssistantApply({ draft, artifactChanged }) {
  const rawPlan = draft?.raw?.dataExtensions?.vibePlan;
  if (!rawPlan) return { advanced: false, synced: false };

  const plan = normalizeVibePlan(rawPlan);
  if (!plan.cursor) plan.cursor = { currentTaskId: "" };

  const picked = pickVibePlanCurrent(plan);
  const currentId = picked.type === "ok" || picked.type === "blocked" ? String(picked.taskId || "") : "";

  if (!artifactChanged) return handleNoArtifactChange(plan, draft);
  return handleArtifactChange(plan, draft, currentId, picked);
}

