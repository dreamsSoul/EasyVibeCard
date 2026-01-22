/**
 * 文件：draftBoard.js
 * 模块：vcard/domain
 * 作用：草稿看板（chatHistory[0]）Markdown 生成与解析（锚点 + JSON 块）
 * 依赖：cardDraft、lint
 * @created 2025-12-29
 * @modified 2026-01-16
 */

import { createEmptyCardDraft, normalizeCardDraft } from "./cardDraft";
import { lintCardDraft } from "./lint";

export const VCARD_DRAFT_JSON_START = "<!-- VCARD_DRAFT_JSON_START -->";
export const VCARD_DRAFT_JSON_END = "<!-- VCARD_DRAFT_JSON_END -->";
const JSON_FENCE = "``````";

function toCodeFenceJson(text) {
  return [`${JSON_FENCE}json`, String(text || "").trim(), JSON_FENCE].join("\n");
}

function safeJsonParse(text) {
  try {
    return { ok: true, value: JSON.parse(String(text || "")) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function pickBoardSnapshot(draft) {
  const d = normalizeCardDraft(draft);
  const { errors, warnings, progress } = lintCardDraft(d);

  d.meta.updatedAt = new Date().toISOString();
  d.meta.progress = progress;
  d.validation.errors = errors;
  d.validation.warnings = warnings;

  return {
    meta: d.meta,
    card: d.card,
    worldbook: d.worldbook,
    regex_scripts: d.regex_scripts,
    tavern_helper: d.tavern_helper,
    validation: d.validation,
    raw: d.raw,
  };
}

function renderPreview(draft) {
  const name = String(draft?.card?.name || "").trim() || "（未命名）";
  const tags = Array.isArray(draft?.card?.tags) ? draft.card.tags : [];
  const oneLine = String(draft?.card?.description || "").trim().split("\n")[0] || "";

  const core = [
    ["description", draft?.card?.description],
    ["personality", draft?.card?.personality],
    ["scenario", draft?.card?.scenario],
  ]
    .filter(([, v]) => String(v || "").trim())
    .map(([k, v]) => `### ${k}\n\n${String(v || "").trim()}`)
    .join("\n\n");

  const firstMes = String(draft?.card?.first_mes || "").trim();
  const firstMesPreview = firstMes.length > 280 ? `${firstMes.slice(0, 280)}…` : firstMes;

  return [
    `### 上：名片区`,
    `- 名称：${name}`,
    `- 标签：${tags.length ? tags.join(" / ") : "（无）"}`,
    oneLine ? `- 一句话：${oneLine}` : `- 一句话：（未填写）`,
    ``,
    `### 中：正文区`,
    core || "（未填写 description/personality/scenario）",
    ``,
    `### 下：对话区`,
    firstMesPreview ? `**first_mes**\n\n${firstMesPreview}` : "（未填写 first_mes）",
  ].join("\n");
}

function renderProgressHeader(snapshot) {
  const p = snapshot?.meta?.progress || {};
  const stepIndex = Number(p.stepIndex) || 1;
  const stepName = String(p.stepName || "");
  const totalSteps = Number(p.totalSteps) || (Array.isArray(p.steps) ? p.steps.length : 0) || 1;
  const errors = Array.isArray(snapshot?.validation?.errors) ? snapshot.validation.errors : [];
  const warnings = Array.isArray(snapshot?.validation?.warnings) ? snapshot.validation.warnings : [];

  const showList = (title, list, limit) => {
    const head = list.slice(0, limit).map((x) => `- ${x}`);
    const more = list.length > limit ? `- ……（剩余 ${list.length - limit} 条）` : "";
    return [`**${title}**`, ...head, more].filter(Boolean).join("\n");
  };

  const protocol = [
    "**输出协议（给 AI）**",
    "- 若需要修改草稿：只输出一个 <tool_use>...</tool_use>（块外禁止解释文字）",
    "- 若只是提问/说明（无需修改）：直接输出纯文本（不要输出 <tool_use>）。",
    "- kind 仅允许：card.patch / worldbook.patch / worldbook.target / regex_scripts.patch / tavern_helper.patch / regex_scripts.set / client_scripts.set",
    "- worldbook.target：输出 worldbook 目标态（含 entries 全量），系统会自动生成 worldbook.patch 应用",
    "- kind 与根路径：card.patch=>card/raw；worldbook.patch=>worldbook；worldbook.target=>worldbook；regex_scripts.patch=>regex_scripts；tavern_helper.patch=>tavern_helper",
    "- patch 仅允许 op=set/remove；path 例：card.name / worldbook.entries[0].content / regex_scripts[0].find.pattern / regex_scripts[0].trimStrings / regex_scripts[0].options.runOnEdit / regex_scripts[0].markdownOnly / tavern_helper.scripts[0].type / tavern_helper.scripts[0].info / tavern_helper.scripts[0].content",
  ].join("\n");

  const vibeTasks = (() => {
    const plan = snapshot?.raw?.dataExtensions?.vibePlan;
    if (!plan || typeof plan !== "object") return "";
    const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
    if (tasks.length === 0) return "";
    const done = tasks.filter((t) => String(t?.status || "") === "done").length;
    const currentId = String(plan?.cursor?.currentTaskId || "");
    const current = tasks.find((t) => String(t?.id || "") === currentId) || null;
    const fmt = (t) => {
      const st = String(t?.status || "todo");
      const mark = st === "done" ? "x" : st === "blocked" ? "!" : " ";
      return `- [${mark}] ${String(t?.title || t?.id || "（未命名任务）")}`;
    };
    const list = tasks.slice(0, 8).map(fmt);
    const more = tasks.length > 8 ? `- ……（剩余 ${tasks.length - 8} 条）` : "";
    return [
      `**Vibe Tasks**：${done}/${tasks.length}`,
      current ? `- 当前：${String(current.title || current.id)}（${String(current.id)}）` : "",
      ...list,
      more,
    ]
      .filter(Boolean)
      .join("\n");
  })();

  return [
    `**当前步骤**：Step ${stepIndex}/${totalSteps} - ${stepName}`,
    `**更新时间**：${String(snapshot?.meta?.updatedAt || "")}`,
    protocol,
    vibeTasks ? `\n${vibeTasks}` : "",
    ``,
    showList("Errors", errors, 5),
    ``,
    showList("Warnings", warnings, 5),
  ].join("\n");
}

export function buildInitialDraftBoardMessage() {
  const draft = createEmptyCardDraft();
  return buildDraftBoardMarkdown(draft);
}

/**
 * 中文注释：
 * buildDraftBoardMarkdown(draft)
 * 作用：生成 chatHistory[0] 的草稿看板 Markdown（上/中/下 + 锚点 JSON）
 * 约束：仅“下”区块参与解析；JSON 块必须唯一且可解析
 * 参数：
 *  - draft: object（CardDraft）
 * 返回：string（Markdown）
 */
export function buildDraftBoardMarkdown(draft) {
  const snapshot = pickBoardSnapshot(draft);
  const jsonText = JSON.stringify(snapshot, null, 2);
  const progressMd = renderProgressHeader(snapshot);
  const previewMd = renderPreview(snapshot);

  return [
    "## Vibe Progress",
    progressMd,
    "",
    "## Card Preview",
    previewMd,
    "",
    "## CardDraft JSON",
    "",
    VCARD_DRAFT_JSON_START,
    toCodeFenceJson(jsonText),
    VCARD_DRAFT_JSON_END,
    "",
  ].join("\n");
}

function findAllAnchors(text) {
  const s = String(text || "");
  const all = [];
  let from = 0;
  while (true) {
    const start = s.indexOf(VCARD_DRAFT_JSON_START, from);
    if (start < 0) break;
    const end = s.indexOf(VCARD_DRAFT_JSON_END, start + VCARD_DRAFT_JSON_START.length);
    if (end < 0) break;
    all.push({ start, end: end + VCARD_DRAFT_JSON_END.length });
    from = end + VCARD_DRAFT_JSON_END.length;
  }
  return all;
}

function extractJsonFromAnchoredBlock(text) {
  const block = String(text || "");
  const m = block.match(/(`{3,})json\s*([\s\S]*?)\s*\1/i);
  if (!m) return null;
  return String(m[2] || "").trim();
}

/**
 * 中文注释：
 * parseDraftFromBoardMarkdown(markdown)
 * 作用：从 chatHistory[0].content 解析 CardDraft（取最后一组锚点）
 * 约束：找不到锚点视为未初始化；JSON 解析失败则返回错误（不应用）
 * 参数：
 *  - markdown: string（看板内容）
 * 返回：{ ok:boolean, draft?:object, error?:string, rawJson?:string }
 */
export function parseDraftFromBoardMarkdown(markdown) {
  const anchors = findAllAnchors(markdown);
  if (anchors.length === 0) return { ok: false, error: "草稿看板未初始化（未找到锚点）。" };

  const last = anchors[anchors.length - 1];
  const chunk = String(markdown || "").slice(last.start, last.end);
  const jsonText = extractJsonFromAnchoredBlock(chunk);
  if (!jsonText) return { ok: false, error: "草稿看板锚点存在，但未找到 ```json 代码块。" };

  const parsed = safeJsonParse(jsonText);
  if (!parsed.ok) return { ok: false, error: `草稿 JSON 解析失败：${parsed.error}`, rawJson: jsonText };

  const draft = normalizeCardDraft(parsed.value);
  const linted = lintCardDraft(draft);
  draft.validation.errors = linted.errors;
  draft.validation.warnings = linted.warnings;
  draft.meta.progress = linted.progress;
  return { ok: true, draft, rawJson: jsonText };
}
