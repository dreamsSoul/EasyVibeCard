/**
 * 文件：controlMessage.js
 * 模块：vcard/domain
 * 作用：生成写入 chatHistory 的 Vibe 控制指令（让任意预设也能按协议输出）
 * 依赖：无
 * @created 2025-12-29
 * @modified 2026-01-16
 */

export const VCARD_CONTROL_PREFIX = "【VCARD_CTRL】";

export function isVcardControlMessageText(text) {
  return String(text || "").trimStart().startsWith(VCARD_CONTROL_PREFIX);
}

function pickProgress(draft) {
  const p = draft?.meta?.progress;
  if (!p || typeof p !== "object") return { stepIndex: 1, totalSteps: 1, stepName: "初始化", nextAction: null };
  const totalSteps = Number(p.totalSteps) || (Array.isArray(p.steps) ? p.steps.length : 0) || 1;
  return {
    stepIndex: Number(p.stepIndex) || 1,
    totalSteps,
    stepName: String(p.stepName || "初始化"),
    nextAction: p.nextAction && typeof p.nextAction === "object" ? p.nextAction : null,
  };
}

function formatAllowedKinds() {
  return [
    "card.patch",
    "worldbook.patch",
    "worldbook.target",
    "regex_scripts.patch",
    "tavern_helper.patch",
    "regex_scripts.set",
    "client_scripts.set",
  ].join(" / ");
}

/**
 * 中文注释：
 * buildVcardControlText({ draft, intent, reason })
 * 作用：生成写入 chatHistory 的控制指令文本（强制模型按 kind+patch 协议输出）
 * 约束：必须是 user/assistant 可读文本；不依赖预设；避免输出可被误当作“最终工具调用”的片段
 * 参数：
 *  - draft: object（CardDraft）
 *  - intent: 'run'|'auto'|'retry'（控制类型）
 *  - reason: string（本轮任务描述；优先使用 progress.nextAction.text）
 * 返回：string
 */
export function buildVcardControlText({ draft, intent, reason }) {
  const p = pickProgress(draft);
  const nextActionText = String(p.nextAction?.text || "").trim();
  const task = String(reason || nextActionText || "").trim();

  const header = `${VCARD_CONTROL_PREFIX}${intent === "retry" ? "纠偏重试" : intent === "auto" ? "自动推进" : "执行"}`;
  const lines = [
    header,
    "",
    `当前：Step ${p.stepIndex}/${p.totalSteps} - ${p.stepName}`,
    task ? `任务：${task}` : "任务：请根据草稿看板补齐本步缺失内容，并推进到下一步。",
    "",
    "输出协议（必须严格遵守）：",
    "1) 若需要修改草稿：只输出一个 <tool_use>...</tool_use> 块（块外禁止任何解释/Markdown/多余文本）",
    "2) 若只是提问/说明（无需修改）：直接输出纯文本（不要输出 <tool_use>）。",
    `3) kind 白名单：${formatAllowedKinds()}`,
    "4) kind=*.patch 时必须包含 patch[]，且 op 仅允许 set/remove",
    "5) kind=worldbook.target 时必须包含 worldbook（含 entries 全量）；系统会自动生成 worldbook.patch 应用（你无需手写 patch）",
    "6) kind 与根路径对应：card.patch=>card/raw；worldbook.patch=>worldbook；worldbook.target=>worldbook（目标态）；regex_scripts.patch=>regex_scripts；tavern_helper.patch=>tavern_helper",
    "7) patch path 例（仅用于 kind=*.patch）：card.name、raw.dataExtensions.vibePlan、worldbook.entries[0].content、regex_scripts[0].find.pattern、regex_scripts[0].trimStrings、regex_scripts[0].options.minDepth、regex_scripts[0].markdownOnly、tavern_helper.scripts[0].type、tavern_helper.scripts[0].info、tavern_helper.scripts[0].content、tavern_helper.variables.someKey",
    "8) 不要输出完整 CardDraft（系统会自动应用并回写看板）",
    "9) raw 约束：仅允许修改 raw.dataExtensions.vibePlan（任务清单）；且不允许与其他字段的修改混合（需要拆成两次）。",
  ];

  return lines.join("\n").trim();
}
