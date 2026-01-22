/**
 * 文件：vibePlan.js
 * 模块：vcard/domain
 * 作用：Vibe 任务清单（vibePlan）：归一化、依赖分析（dependsOn）、选择当前任务与推进
 * 依赖：无
 * @created 2025-12-29
 * @modified 2026-01-01
 */

const PLAN_VERSION = "v1";
const TASK_STATUS = Object.freeze(["todo", "doing", "done", "blocked"]);

function nowIso() {
  return new Date().toISOString();
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function toStringOrEmpty(value) {
  return String(value ?? "");
}

function toStringArray(value) {
  return (Array.isArray(value) ? value : [])
    .map((x) => String(x ?? "").trim())
    .filter((x) => x.length > 0);
}

function normalizeTask(raw, idx, usedIds) {
  const obj = isPlainObject(raw) ? raw : {};
  const baseId = String(obj.id || "").trim() || `task_${idx + 1}`;

  let id = baseId;
  let bump = 1;
  while (usedIds.has(id)) {
    bump += 1;
    id = `${baseId}_${bump}`;
  }
  usedIds.add(id);

  const title = String(obj.title || obj.name || "").trim() || `任务 ${idx + 1}`;
  const statusRaw = String(obj.status || "todo");
  const status = TASK_STATUS.includes(statusRaw) ? statusRaw : "todo";
  const dependsOn = toStringArray(obj.dependsOn);

  const kindHint = String(obj.kindHint || "").trim();
  const patchHints = toStringArray(obj.patchHints);
  const doneCriteria = toStringArray(obj.doneCriteria);
  const notes = toStringOrEmpty(obj.notes);

  return { id, title, status, dependsOn, kindHint, patchHints, doneCriteria, notes };
}

/**
 * 中文注释：
 * normalizeVibePlan(raw)
 * 作用：把任意输入归一化为 vibePlan（任务数自由，支持 dependsOn）
 * 约束：仅做结构归一化，不做推进（纯函数）
 * 参数：
 *  - raw: any（raw.dataExtensions.vibePlan）
 * 返回：object（vibePlan）
 */
export function normalizeVibePlan(raw) {
  const obj = isPlainObject(raw) ? raw : {};
  const usedIds = new Set();
  const tasks = (Array.isArray(obj.tasks) ? obj.tasks : []).map((t, idx) => normalizeTask(t, idx, usedIds));
  const cursorObj = isPlainObject(obj.cursor) ? obj.cursor : {};
  const cursor = { currentTaskId: String(cursorObj.currentTaskId || "").trim() };

  return {
    version: String(obj.version || PLAN_VERSION),
    goal: toStringOrEmpty(obj.goal).trim(),
    createdAt: String(obj.createdAt || nowIso()),
    updatedAt: String(obj.updatedAt || nowIso()),
    tasks,
    cursor,
  };
}

function buildTaskMap(plan) {
  const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
  return new Map(tasks.map((t) => [String(t.id), t]));
}

function detectCycleFrom(taskId, byId, stack, visited) {
  const id = String(taskId || "");
  if (visited.has(id)) return null;
  if (stack.includes(id)) {
    const idx = stack.indexOf(id);
    return [...stack.slice(idx), id];
  }
  const task = byId.get(id);
  if (!task) return null;
  stack.push(id);
  for (const depId of Array.isArray(task.dependsOn) ? task.dependsOn : []) {
    if (!byId.has(depId)) continue;
    const cycle = detectCycleFrom(depId, byId, stack, visited);
    if (cycle) return cycle;
  }
  stack.pop();
  visited.add(id);
  return null;
}

function detectCycle(plan) {
  const byId = buildTaskMap(plan);
  const visited = new Set();
  for (const id of byId.keys()) {
    const cycle = detectCycleFrom(id, byId, [], visited);
    if (cycle) return cycle;
  }
  return null;
}

function resolveActionableTaskId(taskId, byId, trail) {
  const id = String(taskId || "");
  if (!id) return { type: "invalid", missingId: "（空 id）" };
  if (trail.includes(id)) return { type: "cycle", cycle: [...trail, id] };
  const task = byId.get(id);
  if (!task) return { type: "invalid", missingId: id };
  if (task.status === "blocked") return { type: "blocked", taskId: id };
  if (task.status === "done") return { type: "done", taskId: id };

  for (const depId of Array.isArray(task.dependsOn) ? task.dependsOn : []) {
    const dep = byId.get(depId);
    if (!dep) return { type: "invalid_dep", taskId: id, missingId: depId };
    if (dep.status === "done") continue;
    return resolveActionableTaskId(depId, byId, [...trail, id]);
  }
  return { type: "ok", taskId: id };
}

/**
 * 中文注释：
 * pickVibePlanCurrent(plan)
 * 作用：根据 cursor + dependsOn 选择“当前可执行任务”（会优先补齐依赖任务）
 * 约束：不修改 plan（纯函数）；发现循环依赖/缺失依赖会返回 error 类型
 * 参数：
 *  - plan: object（normalizeVibePlan 的输出）
 * 返回：{ type:'need_plan'|'ok'|'blocked'|'all_done'|'invalid_dep'|'cycle', taskId?:string, cycle?:string[], missingId?:string }
 */
export function pickVibePlanCurrent(plan) {
  const norm = normalizeVibePlan(plan);
  const tasks = norm.tasks;
  if (tasks.length === 0) return { type: "need_plan" };

  const cycle = detectCycle(norm);
  if (cycle) return { type: "cycle", cycle };

  const byId = buildTaskMap(norm);
  const cursorId = String(norm.cursor?.currentTaskId || "");
  const startIndex = cursorId ? tasks.findIndex((t) => t.id === cursorId) : 0;
  const from = startIndex >= 0 ? startIndex : 0;
  const ordered = [...tasks.slice(from), ...tasks.slice(0, from)];

  for (const t of ordered) {
    if (t.status === "done") continue;
    const r = resolveActionableTaskId(t.id, byId, []);
    if (r.type === "done") continue;
    if (r.type === "ok") return { type: "ok", taskId: r.taskId };
    if (r.type === "blocked") return { type: "blocked", taskId: r.taskId };
    if (r.type === "invalid_dep") return { type: "invalid_dep", taskId: r.taskId, missingId: r.missingId };
    if (r.type === "cycle") return { type: "cycle", cycle: r.cycle };
    return { type: "invalid_dep", taskId: t.id, missingId: r.missingId || "（未知）" };
  }

  return { type: "all_done" };
}

export function summarizeVibePlanIssues(plan) {
  const norm = normalizeVibePlan(plan);
  const byId = buildTaskMap(norm);
  const warnings = [];

  for (const t of norm.tasks) {
    for (const depId of Array.isArray(t.dependsOn) ? t.dependsOn : []) {
      if (!byId.has(depId)) warnings.push(`vibePlan：任务 ${t.id} dependsOn 未找到任务：${depId}`);
    }
  }
  const cycle = detectCycle(norm);
  if (cycle) warnings.push(`vibePlan：任务依赖存在循环：${cycle.join(" -> ")}`);

  return { warnings };
}

function pickTaskById(plan, id) {
  const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
  return tasks.find((t) => String(t.id) === String(id));
}

function shiftCursorAfter(plan, finishedId) {
  const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
  const idx = tasks.findIndex((t) => t.id === finishedId);
  if (idx < 0 || tasks.length === 0) return;
  const nextIdx = idx + 1 < tasks.length ? idx + 1 : 0;
  plan.cursor.currentTaskId = tasks[nextIdx]?.id || "";
}

/**
 * 中文注释：
 * advanceVibePlan(plan, finishedTaskId)
 * 作用：把 finishedTaskId 标记为 done，并把 cursor 推进到下一个可执行任务
 * 约束：返回新对象（不修改入参）；若无法推进则 cursor 置空
 * 参数：
 *  - plan: object
 *  - finishedTaskId: string
 * 返回：object（next plan）
 */
export function advanceVibePlan(plan, finishedTaskId) {
  const next = normalizeVibePlan(plan);
  const id = String(finishedTaskId || "").trim();
  const task = pickTaskById(next, id);
  if (task && task.status !== "done") task.status = "done";

  if (!next.cursor) next.cursor = { currentTaskId: "" };
  shiftCursorAfter(next, id);

  const picked = pickVibePlanCurrent(next);
  if (picked.type === "ok" || picked.type === "blocked") next.cursor.currentTaskId = picked.taskId;
  else next.cursor.currentTaskId = "";

  next.updatedAt = nowIso();
  return next;
}
