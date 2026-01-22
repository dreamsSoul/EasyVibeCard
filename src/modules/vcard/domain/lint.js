/**
 * 文件：lint.js
 * 模块：vcard/domain
 * 作用：对 CardDraft 做最小校验并生成进度（step/blocker/nextAction）
 * 依赖：worldbookPositions
 * @created 2025-12-29
 * @modified 2026-01-16
 */

import { isAtDepthPositionKey } from "./worldbookPositions";
import { resolveFindRegex, tryCompileRegex } from "./regexUtils";
import { normalizeVibePlan, pickVibePlanCurrent, summarizeVibePlanIssues } from "./vibePlan";

const REGEX_PLACEMENT_ALLOWED = new Set([0, 1, 2, 3, 5, 6]);
const REGEX_PLACEMENT_DEPRECATED = new Set([0]);
const SUBSTITUTE_REGEX_ALLOWED = new Set([0, 1, 2]);

function uniq(list) {
  return Array.from(new Set((Array.isArray(list) ? list : []).filter(Boolean)));
}

function pushIf(list, cond, text) {
  if (cond) list.push(String(text || ""));
}

function evalWorldbook(draft) {
  const errors = [];
  const warnings = [];
  const entries = Array.isArray(draft?.worldbook?.entries) ? draft.worldbook.entries : [];
  entries.forEach((e, idx) => {
    const prefix = `世界书第 ${idx + 1} 条`;
    const light = String(e?.light || "blue");
    const keys = Array.isArray(e?.keys) ? e.keys : [];
    if (light === "green" && keys.length === 0) errors.push(`${prefix}：绿灯条目必须包含 keys。`);
    if (isAtDepthPositionKey(e?.position) && !Number.isFinite(Number(e?.at_depth?.depth))) errors.push(`${prefix}：at_depth 位置必须提供 depth。`);
    if (!String(e?.content || "").trim()) warnings.push(`${prefix}：content 为空（不会注入任何内容）。`);
  });
  return { errors, warnings, hasAny: entries.length > 0 };
}

function evalRegexScripts(draft) {
  const errors = [];
  const warnings = [];
  const scripts = Array.isArray(draft?.regex_scripts) ? draft.regex_scripts : [];
  scripts.forEach((s, idx) => {
    const name = String(s?.name || s?.id || `#${idx + 1}`);

    const placement = Array.isArray(s?.placement) ? s.placement : [];
    if (placement.length === 0) warnings.push(`regex_scripts ${name}：placement 为空（脚本不会生效）。`);
    const invalidPlacement = placement.filter((p) => Number.isFinite(Number(p)) && !REGEX_PLACEMENT_ALLOWED.has(Number(p)));
    if (invalidPlacement.length > 0) warnings.push(`regex_scripts ${name}：placement 包含非法值：${invalidPlacement.join(", ")}。`);
    const deprecatedPlacement = placement.filter((p) => REGEX_PLACEMENT_DEPRECATED.has(Number(p)));
    if (deprecatedPlacement.length > 0) warnings.push(`regex_scripts ${name}：placement 包含 deprecated 值：${deprecatedPlacement.join(", ")}（MD_DISPLAY 已废弃）。`);

    const minDepth = s?.options?.minDepth;
    const maxDepth = s?.options?.maxDepth;
    if (minDepth !== null && minDepth !== undefined && !Number.isFinite(Number(minDepth))) warnings.push(`regex_scripts ${name}：minDepth 不是合法数字。`);
    if (maxDepth !== null && maxDepth !== undefined && !Number.isFinite(Number(maxDepth))) warnings.push(`regex_scripts ${name}：maxDepth 不是合法数字。`);
    if (Number.isFinite(Number(minDepth)) && Number(minDepth) < -1) warnings.push(`regex_scripts ${name}：minDepth 小于 -1（可能被 ST 视为无效）。`);
    if (Number.isFinite(Number(maxDepth)) && Number(maxDepth) < 0) warnings.push(`regex_scripts ${name}：maxDepth 小于 0（可能被 ST 视为无效）。`);
    if (Number.isFinite(Number(minDepth)) && Number.isFinite(Number(maxDepth)) && Number(maxDepth) < Number(minDepth)) {
      warnings.push(`regex_scripts ${name}：maxDepth < minDepth（深度范围无效）。`);
    }

    const substituteRegex = s?.options?.substituteRegex;
    if (substituteRegex !== null && substituteRegex !== undefined) {
      const v = Number(substituteRegex);
      if (!Number.isFinite(v) || !SUBSTITUTE_REGEX_ALLOWED.has(Math.trunc(v))) warnings.push(`regex_scripts ${name}：substituteRegex 值非法（仅允许 0/1/2）。`);
    }

    const resolved = resolveFindRegex(s?.find);
    resolved.warnings.forEach((w) => warnings.push(`regex_scripts ${name}：${w}`));
    const compiled = tryCompileRegex(resolved.pattern, resolved.flags);
    if (compiled.ok) return;
    if (Boolean(s?.enabled)) errors.push(`regex_scripts ${name}：findRegex 编译失败：${compiled.error}`);
    else warnings.push(`regex_scripts ${name}：findRegex 编译失败（已禁用）：${compiled.error}`);
  });
  return { errors, warnings, hasAny: scripts.length > 0 };
}

function buildNeedPlanProgress() {
  const nextAction = {
    type: "ask_model",
    text: [
      "先生成任务清单：输出 <tool_use>（name=card.patch），仅 set raw.dataExtensions.vibePlan。",
      "要求：任务数自由；每个任务应能在 1 轮内完成；可使用 dependsOn 表示依赖；cursor.currentTaskId 指向首个可执行任务。",
      "注意：本轮不要修改 card/worldbook/regex/tavern_helper。",
    ].join("\n"),
  };

  return {
    stepIndex: 1,
    stepName: "任务规划",
    totalSteps: 1,
    steps: [{ index: 1, name: "生成任务清单（vibePlan）", status: "todo", doneCriteria: ["vibePlan 已生成"], blockers: [], nextAction }],
    nextAction,
  };
}

function buildTaskSteps(plan, currentTaskId) {
  const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
  return tasks.map((t, idx) => {
    const isCurrent = String(t.id) === String(currentTaskId || "");
    const status = t.status === "done" ? "done" : t.status === "blocked" ? "blocked" : isCurrent ? "doing" : "todo";
    const blockers = t.status === "blocked" ? [String(t.notes || "任务被阻塞。").trim() || "任务被阻塞。"] : [];
    return { index: idx + 1, name: String(t.title || `任务 ${idx + 1}`), status, doneCriteria: Array.isArray(t.doneCriteria) ? t.doneCriteria : [], blockers, nextAction: { type: "ask_user", text: "" } };
  });
}

function buildTaskInstruction(plan, taskId) {
  const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
  const t = tasks.find((x) => String(x.id) === String(taskId || ""));
  if (!t) return "任务不存在：请修复 vibePlan。";
  const depends = Array.isArray(t.dependsOn) && t.dependsOn.length ? `依赖：${t.dependsOn.join(", ")}` : "";
  const kindHint = String(t.kindHint || "").trim() ? `建议 kind：${String(t.kindHint || "").trim()}` : "";
  const pathHint = Array.isArray(t.patchHints) && t.patchHints.length ? `建议 path：${t.patchHints.slice(0, 10).join(", ")}` : "";
  const criteria = Array.isArray(t.doneCriteria) && t.doneCriteria.length ? `完成判据：${t.doneCriteria.slice(0, 6).join("；")}` : "";
  return [
    `执行当前任务：${String(t.title || "")}（${String(t.id || "")}）`,
    depends,
    kindHint,
    pathHint,
    criteria,
    "只需完成该任务的最小 patch/set；不要修改 raw.dataExtensions.vibePlan（系统会自动标记 done 并推进）。",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildAllDoneProgress(plan) {
  const steps = buildTaskSteps(plan, "");
  return {
    stepIndex: steps.length || 1,
    stepName: "全部完成",
    totalSteps: steps.length || 1,
    steps,
    nextAction: { type: "ask_user", text: "任务已全部完成，可导出 JSON/PNG（或继续微调）。" },
  };
}

function buildCycleProgress(plan, picked) {
  const steps = buildTaskSteps(plan, "");
  return {
    stepIndex: 1,
    stepName: "任务依赖异常",
    totalSteps: steps.length || 1,
    steps,
    nextAction: { type: "ask_model", text: `vibePlan 存在循环依赖：${picked.cycle.join(" -> ")}\n请输出 <tool_use>（name=card.patch），修复 raw.dataExtensions.vibePlan（清理/重排 dependsOn）。` },
  };
}

function buildInvalidDepProgress(plan, picked) {
  const steps = buildTaskSteps(plan, "");
  return {
    stepIndex: 1,
    stepName: "任务依赖缺失",
    totalSteps: steps.length || 1,
    steps,
    nextAction: { type: "ask_model", text: `vibePlan 依赖缺失：任务 ${picked.taskId} dependsOn 未找到 ${picked.missingId}\n请输出 <tool_use>（name=card.patch），修复 raw.dataExtensions.vibePlan（补齐任务或修正 dependsOn）。` },
  };
}

function buildCurrentTaskProgress(plan, picked) {
  const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
  const currentId = String(picked.taskId || "");
  const steps = buildTaskSteps(plan, currentId);
  const currentIndex = Math.max(1, steps.find((s) => s.status === "doing")?.index || 1);
  const stepTitle = String(tasks[currentIndex - 1]?.title || "任务执行");
  const nextAction = (() => {
    if (picked.type === "blocked") return { type: "ask_user", text: `任务被阻塞：${stepTitle}（${currentId}）。请用户补充信息或手动调整任务清单后继续。` };
    return { type: "ask_model", text: buildTaskInstruction(plan, currentId) };
  })();

  return { stepIndex: currentIndex, stepName: stepTitle, totalSteps: steps.length || 1, steps, nextAction };
}

function buildProgressFromVibePlan(planRaw) {
  const plan = normalizeVibePlan(planRaw);
  const picked = pickVibePlanCurrent(plan);
  const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];

  if (tasks.length === 0) return buildNeedPlanProgress();

  if (picked.type === "all_done") return buildAllDoneProgress(plan);
  if (picked.type === "cycle") return buildCycleProgress(plan, picked);
  if (picked.type === "invalid_dep") return buildInvalidDepProgress(plan, picked);
  return buildCurrentTaskProgress(plan, picked);
}

/**
 * 中文注释：
 * lintCardDraft(draft)
 * 作用：生成 validation（errors/warnings）与 progress（step 状态与 nextAction）
 * 约束：仅做最小校验（KISS）；不改动数据（纯函数）
 * 参数：
 *  - draft: object（CardDraft）
 * 返回：{ errors:string[], warnings:string[], progress:object }
 */
export function lintCardDraft(draft) {
  const errors = [];
  const warnings = [];

  const name = String(draft?.card?.name || "").trim();
  const description = String(draft?.card?.description || "").trim();
  const personality = String(draft?.card?.personality || "").trim();
  const scenario = String(draft?.card?.scenario || "").trim();
  const firstMes = String(draft?.card?.first_mes || "").trim();

  pushIf(errors, !name, "card.name 不能为空。");
  pushIf(errors, !description, "card.description 不能为空。");
  pushIf(errors, !firstMes, "card.first_mes 不能为空。");
  pushIf(warnings, !personality, "card.personality 为空（建议补充）。");
  pushIf(warnings, !scenario, "card.scenario 为空（建议补充）。");

  const wb = evalWorldbook(draft);
  errors.push(...wb.errors);
  warnings.push(...wb.warnings);

  const rs = evalRegexScripts(draft);
  errors.push(...rs.errors);
  warnings.push(...rs.warnings);

  const planRaw = draft?.raw?.dataExtensions?.vibePlan;
  const progress = buildProgressFromVibePlan(planRaw);

  const planIssues = planRaw ? summarizeVibePlanIssues(planRaw) : { warnings: [] };
  warnings.push(...(Array.isArray(planIssues.warnings) ? planIssues.warnings : []));

  return { errors: uniq(errors), warnings: uniq(warnings), progress };
}
