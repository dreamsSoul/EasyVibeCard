/**
 * 文件：useVCardPageMeta.js
 * 模块：角色卡设计器
 * 作用：为 VCardPage 聚合 UI 所需的 computed/行为（避免页面组件过重）
 * 依赖：Vue、vcard/domain/vibePlan
 * @created 2026-01-01
 * @modified 2026-01-21
 */

import { computed, onBeforeUnmount, onMounted } from "vue";
import { normalizeVibePlan, pickVibePlanCurrent } from "../domain/vibePlan";

function pickProgress(draftRef) {
  return draftRef?.value?.meta?.progress || null;
}

function pickStepText(draftRef) {
  const p = pickProgress(draftRef);
  if (!p) return "—";
  const total = Number(p.totalSteps) || (Array.isArray(p.steps) ? p.steps.length : 0) || 1;
  return `${Number(p.stepIndex) || 1}/${total} - ${String(p.stepName || "")}`;
}

function isTextEditingTarget(target) {
  const el = target instanceof HTMLElement ? target : null;
  if (!el) return false;
  const tag = String(el.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return Boolean(el.closest?.('[contenteditable="true"]'));
}

// 中文注释：
// useVCardPageMeta(deps)
// 作用：抽离 VCardPage 的派生状态与页面级交互（快捷键、当前任务信息等）
// 约束：仅做 UI 计算/事件绑定，不直接触发网络请求
// 参数：
//  - deps: { draft, userInput, writeBoard, sending, workflowMode, canUndo, canRedo, undo, redo, clearRunLog, clearChat, initBoard }
// 返回：页面 computed + handlers
export function useVCardPageMeta({ draft, userInput, writeBoard, sending, workflowMode, canUndo, canRedo, undo, redo, clearRunLog, clearChat, initBoard }) {
  const stepText = computed(() => pickStepText(draft));
  const updatedAt = computed(() => String(draft.value?.meta?.updatedAt || ""));
  const errorCount = computed(() => (Array.isArray(draft.value?.validation?.errors) ? draft.value.validation.errors.length : 0));
  const warnCount = computed(() => (Array.isArray(draft.value?.validation?.warnings) ? draft.value.validation.warnings.length : 0));
  const planWorkModeText = computed(() => {
    const m = String(workflowMode?.value || workflowMode || "").trim();
    if (m === "free") return "自由";
    if (m === "task") return "任务";
    return "—";
  });

  const vibePlanSnapshot = computed(() => {
    const planRaw = draft.value?.raw?.dataExtensions?.vibePlan;
    if (!planRaw || typeof planRaw !== "object") return { tasks: [], doneCount: 0, picked: { type: "need_plan" }, current: null };
    const plan = normalizeVibePlan(planRaw);
    const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
    const doneCount = tasks.filter((t) => String(t?.status || "") === "done").length;
    const picked = pickVibePlanCurrent(plan);
    const current = picked.type === "ok" || picked.type === "blocked" ? tasks.find((t) => String(t?.id || "") === String(picked.taskId || "")) || null : null;
    return { tasks, doneCount, picked, current };
  });

  const currentTaskTitle = computed(() => {
    const t = vibePlanSnapshot.value.current;
    if (t) return String(t.title || t.id || "（未命名任务）");
    const stepName = String(draft.value?.meta?.progress?.stepName || "").trim();
    return stepName || "（未就绪）";
  });

  const currentTaskDependsOnText = computed(() => {
    const deps = Array.isArray(vibePlanSnapshot.value.current?.dependsOn) ? vibePlanSnapshot.value.current.dependsOn : [];
    return deps.length ? deps.join(", ") : "";
  });

  const currentTaskCriteria = computed(() => {
    const t = vibePlanSnapshot.value.current;
    if (Array.isArray(t?.doneCriteria) && t.doneCriteria.length) return t.doneCriteria;
    const p = pickProgress(draft);
    const steps = Array.isArray(p?.steps) ? p.steps : [];
    const idx = Number(p?.stepIndex) || 1;
    const step = steps.find((s) => Number(s?.index) === idx) || steps[idx - 1] || null;
    return Array.isArray(step?.doneCriteria) ? step.doneCriteria : [];
  });

  const suggestText = computed(() => String(draft.value?.meta?.progress?.nextAction?.text || "").trim());
  function fillSuggested() {
    const t = suggestText.value;
    if (!t) return;
    userInput.value = t;
  }

  function lintOnly() {
    if (!draft.value) return;
    writeBoard(draft.value);
  }

  async function resetWorkspace() {
    if (sending.value) return;
    if (!confirm("确定清空角色卡草稿与对话记录吗？\n\n（资源管理器不会被清空）")) return;
    clearRunLog();
    await clearChat();
    await initBoard({ force: true });
  }

  function onGlobalKeydown(e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.defaultPrevented) return;
    if (isTextEditingTarget(e.target)) return;

    const key = String(e.key || "").toLowerCase();
    if (key === "z" && !e.shiftKey) {
      if (!canUndo.value) return;
      e.preventDefault();
      undo();
      return;
    }
    if (key === "y" || (key === "z" && e.shiftKey)) {
      if (!canRedo.value) return;
      e.preventDefault();
      redo();
    }
  }

  onMounted(() => window.addEventListener("keydown", onGlobalKeydown));
  onBeforeUnmount(() => window.removeEventListener("keydown", onGlobalKeydown));

  return {
    stepText,
    planWorkModeText,
    updatedAt,
    errorCount,
    warnCount,
    currentTaskTitle,
    currentTaskDependsOnText,
    currentTaskCriteria,
    suggestText,
    fillSuggested,
    lintOnly,
    resetWorkspace,
  };
}
