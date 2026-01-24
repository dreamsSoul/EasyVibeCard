/**
 * 文件：cardDraft.js
 * 模块：vcard/domain
 * 作用：CardDraft（内部统一形）的默认值、归一化与轻量校验工具
 * 依赖：worldbookPositions
 * @created 2025-12-29
 * @modified 2026-01-01
 */

import { isAtDepthPositionKey, isWorldbookPositionKey } from "./worldbookPositions";
import { ensureWorldbookEntryIds } from "./worldbookEntryIds";

function nowIso() {
  return new Date().toISOString();
}

function toPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

function toStringOrEmpty(value) {
  return String(value ?? "");
}

function toStringArray(value) {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((x) => String(x ?? "").trim())
    .filter((x) => x.length > 0);
}

function toBool(value, fallback) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  return Boolean(fallback);
}

function toFiniteNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toIntOrNull(value) {
  const n = toFiniteNumberOrNull(value);
  if (n === null) return null;
  return Math.trunc(n);
}

function normalizeAtDepth(value) {
  const obj = toPlainObject(value) || {};
  const depth = toIntOrNull(obj.depth);
  return depth === null ? null : { depth: Math.max(0, depth) };
}

export function createEmptyCardDraft() {
  return {
    meta: {
      spec: "chara_card_v3",
      spec_version: "3.0",
      updatedAt: nowIso(),
      progress: { stepIndex: 1, stepName: "初始化" },
    },
    card: {
      name: "",
      description: "",
      personality: "",
      scenario: "",
      first_mes: "",
      mes_example: "",
      creator_notes: "",
      system_prompt: "",
      post_history_instructions: "",
      alternate_greetings: [],
      tags: [],
    },
    worldbook: { name: "", entries: [] },
    regex_scripts: [],
    tavern_helper: { scripts: [], variables: {} },
    validation: { errors: [], warnings: [] },
    raw: { dataExtensions: {} },
  };
}

/**
 * 中文注释：
 * normalizeWorldbookEntryLite(raw)
 * 作用：把任意输入归一化为 WorldbookEntryLite（面向蓝/绿灯 + 10 位置）
 * 约束：只保留 Lite 字段；未知 extensions 进 raw_extensions
 * 参数：
 *  - raw: any（输入条目）
 * 返回：object（WorldbookEntryLite）
 */
export function normalizeWorldbookEntryLite(raw) {
  const obj = toPlainObject(raw) || {};
  const id = obj.id === undefined ? null : toFiniteNumberOrNull(obj.id) ?? String(obj.id || "");
  const enabled = toBool(obj.enabled, true);
  const light = String(obj.light || "blue") === "green" ? "green" : "blue";

  const keys = toStringArray(obj.keys);
  const secondary_keys = toStringArray(obj.secondary_keys);
  const secondary_logic = ["and_any", "and_all", "not_all", "not_any"].includes(String(obj.secondary_logic || ""))
    ? String(obj.secondary_logic)
    : "and_any";

  const comment = toStringOrEmpty(obj.comment);
  const content = toStringOrEmpty(obj.content);

  const position = isWorldbookPositionKey(obj.position) ? String(obj.position) : "after_char";
  const at_depth = isAtDepthPositionKey(position) ? normalizeAtDepth(obj.at_depth) : null;

  const order = (() => {
    const n = toFiniteNumberOrNull(obj.order);
    if (n === null) return 100;
    return Math.max(0, n);
  })();

  const use_regex = toBool(obj.use_regex, true);
  const raw_extensions = toPlainObject(obj.raw_extensions) || null;

  const out = { id, enabled, light, keys, secondary_keys, secondary_logic, comment, content, position, order, use_regex };
  if (at_depth) out.at_depth = at_depth;
  if (raw_extensions) out.raw_extensions = raw_extensions;
  return out;
}

export function normalizeRegexScriptLite(raw) {
  const obj = toPlainObject(raw) || {};
  const id = toStringOrEmpty(obj.id) || "";
  const name = toStringOrEmpty(obj.name);
  const enabled = toBool(obj.enabled, true);
  const placement = (Array.isArray(obj.placement) ? obj.placement : [])
    .map((x) => toFiniteNumberOrNull(x))
    .filter((x) => x !== null)
    .map((x) => Math.trunc(x));

  const findObj = toPlainObject(obj.find) || {};
  const pattern = toStringOrEmpty(findObj.pattern);
  const flags = toStringOrEmpty(findObj.flags);
  const style = ["slash", "raw"].includes(String(findObj.style || "")) ? String(findObj.style) : "raw";
  const replace = toStringOrEmpty(obj.replace);

  const trimStrings = toStringArray(obj.trimStrings);

  const { markdownOnly, promptOnly } = (() => {
    const md = obj.markdownOnly;
    const pr = obj.promptOnly;
    if (md !== undefined || pr !== undefined) {
      return { markdownOnly: toBool(md, false), promptOnly: toBool(pr, false) };
    }
    const phase = ["display", "prompt", "both"].includes(String(obj.phase || "")) ? String(obj.phase) : "both";
    return { markdownOnly: phase === "display", promptOnly: phase === "prompt" };
  })();

  const optionsObj = toPlainObject(obj.options) || {};
  const toFiniteNumberOrNullPreserveNull = (value) => {
    if (value === null || value === undefined || value === "") return null;
    return toFiniteNumberOrNull(value);
  };

  const substituteRegexRaw = toFiniteNumberOrNullPreserveNull(optionsObj.substituteRegex ?? obj.substituteRegex);
  const minDepthRaw = toFiniteNumberOrNullPreserveNull(optionsObj.minDepth ?? obj.minDepth);
  const maxDepthRaw = toFiniteNumberOrNullPreserveNull(optionsObj.maxDepth ?? obj.maxDepth);
  const options = {
    runOnEdit: toBool(optionsObj.runOnEdit ?? obj.runOnEdit, false),
    substituteRegex: substituteRegexRaw === null ? 0 : Math.trunc(substituteRegexRaw),
    minDepth: minDepthRaw === null ? null : Math.trunc(minDepthRaw),
    maxDepth: maxDepthRaw === null ? null : Math.trunc(maxDepthRaw),
  };

  const out = { id, name, enabled, placement, find: { pattern, flags, style }, replace, trimStrings, markdownOnly, promptOnly, options };
  return out;
}

export function normalizeTavernHelperPackLite(raw) {
  const obj = toPlainObject(raw) || {};
  const scripts = (Array.isArray(obj.scripts) ? obj.scripts : [])
    .map((s) => {
      const o = toPlainObject(s) || {};
      const buttonObj = toPlainObject(o.button) || {};
      return {
        id: toStringOrEmpty(o.id),
        name: toStringOrEmpty(o.name),
        // 约束：导出格式（tavern_helper.scripts[i].type）仅支持 script；其他值一律覆盖为 script。
        type: "script",
        info: toStringOrEmpty(o.info),
        enabled: toBool(o.enabled, true),
        content: toStringOrEmpty(o.content),
        button: { enabled: toBool(buttonObj.enabled, true), buttons: Array.isArray(buttonObj.buttons) ? buttonObj.buttons : [] },
        data: toPlainObject(o.data) || {},
      };
    })
    .filter((s) => s.id || s.name || s.content || s.info);
  const variables = toPlainObject(obj.variables) || {};
  return { scripts, variables };
}

export function normalizeCardDraft(raw) {
  const base = createEmptyCardDraft();
  const obj = toPlainObject(raw) || {};

  const meta = toPlainObject(obj.meta) || {};
  base.meta.spec = String(meta.spec || base.meta.spec);
  base.meta.spec_version = String(meta.spec_version || base.meta.spec_version);
  base.meta.updatedAt = String(meta.updatedAt || base.meta.updatedAt);

  const card = toPlainObject(obj.card) || {};
  for (const k of Object.keys(base.card)) {
    if (k === "alternate_greetings" || k === "tags") continue;
    base.card[k] = toStringOrEmpty(card[k]);
  }
  base.card.alternate_greetings = toStringArray(card.alternate_greetings);
  base.card.tags = toStringArray(card.tags);

  const worldbook = toPlainObject(obj.worldbook) || {};
  base.worldbook.name = toStringOrEmpty(worldbook.name);
  base.worldbook.entries = (Array.isArray(worldbook.entries) ? worldbook.entries : []).map(normalizeWorldbookEntryLite);
  const fixed = ensureWorldbookEntryIds(base.worldbook.entries);
  if (fixed.changed) base.worldbook.entries = fixed.entries;

  base.regex_scripts = (Array.isArray(obj.regex_scripts) ? obj.regex_scripts : []).map(normalizeRegexScriptLite);
  base.tavern_helper = normalizeTavernHelperPackLite(obj.tavern_helper);

  const validation = toPlainObject(obj.validation) || {};
  base.validation.errors = toStringArray(validation.errors);
  base.validation.warnings = toStringArray(validation.warnings);

  const rawObj = toPlainObject(obj.raw) || {};
  base.raw.dataExtensions = toPlainObject(rawObj.dataExtensions) || {};

  const progress = toPlainObject(meta.progress) || {};
  const stepIndex = toFiniteNumberOrNull(progress.stepIndex);
  const stepName = toStringOrEmpty(progress.stepName);
  if (stepIndex !== null && stepName) base.meta.progress = { stepIndex: Math.max(1, Math.trunc(stepIndex)), stepName };

  return base;
}
