/**
 * 文件：indexText.js
 * 模块：server/entities/vcard/readProtocol
 * 作用：生成“可读条目索引”文本（用于 read 目录读取与提示词注入）
 * 依赖：utils
 * @created 2026-01-21
 * @modified 2026-01-21
 */

import { isPlainObject, normalizePathSegment, toStringOrEmpty } from "./utils.js";

const CARD_TEXT_KEYS = [
  "description",
  "personality",
  "scenario",
  "first_mes",
  "mes_example",
  "system_prompt",
  "creator_notes",
  "post_history_instructions",
];

function pickRootName(snapshot) {
  const name = normalizePathSegment(snapshot?.card?.name);
  return name || "角色名";
}

function trimText(value) {
  return String(value ?? "").trim();
}

function lenOrEmptyMark(text) {
  const t = trimText(text);
  return t ? `${t.length} chars` : "（空）";
}

function formatBool(value) {
  return value ? "true" : "false";
}

function safeNameOrIndex(name, idx) {
  const n = normalizePathSegment(name);
  return n || `[${Number(idx)}]`;
}

function takeWithMore(list, max) {
  const arr = Array.isArray(list) ? list : [];
  const limit = Math.max(0, Number(max) || 0);
  if (limit <= 0) return { items: [], more: arr.length };
  return { items: arr.slice(0, limit), more: Math.max(0, arr.length - limit) };
}

export function buildCardIndexText(snapshot) {
  const snap = isPlainObject(snapshot) ? snapshot : {};
  const card = isPlainObject(snap.card) ? snap.card : {};
  const lines = [];

  lines.push("card/");
  for (const key of CARD_TEXT_KEYS) {
    lines.push(`  - ${key}: ${lenOrEmptyMark(card?.[key])}`);
  }

  const ag = Array.isArray(card?.alternate_greetings) ? card.alternate_greetings : [];
  if (ag.length === 0) {
    lines.push("  - alternate_greetings/: （空）");
  } else {
    const { items, more } = takeWithMore(ag, 12);
    lines.push(`  - alternate_greetings/: ${ag.length} items`);
    items.forEach((x, i) => lines.push(`    - [${i}]: ${lenOrEmptyMark(x)}`));
    if (more > 0) lines.push(`    - … and ${more} more`);
  }

  return lines.join("\n").trim();
}

export function buildWorldbookIndexText(snapshot) {
  const snap = isPlainObject(snapshot) ? snapshot : {};
  const wb = isPlainObject(snap.worldbook) ? snap.worldbook : {};
  const entries = Array.isArray(wb.entries) ? wb.entries : [];
  const lines = [];

  lines.push("worldbook/");
  lines.push(`  - name: ${normalizePathSegment(wb?.name) || "（空）"}`);
  if (entries.length === 0) {
    lines.push("  - entries/: （空）");
    return lines.join("\n").trim();
  }

  const { items, more } = takeWithMore(entries, 60);
  lines.push(`  - entries/: ${entries.length} items`);
  items.forEach((e, idx) => {
    const name = safeNameOrIndex(e?.comment, idx);
    const enabled = formatBool(Boolean(e?.enabled));
    const position = normalizePathSegment(e?.position) || "";
    const len = lenOrEmptyMark(toStringOrEmpty(e?.content));
    const posText = position ? `, position=${position}` : "";
    lines.push(`    - ${name}: enabled=${enabled}${posText}, len=${len}`);
  });
  if (more > 0) lines.push(`    - … and ${more} more`);

  return lines.join("\n").trim();
}

export function buildRegexScriptsIndexText(snapshot) {
  const snap = isPlainObject(snapshot) ? snapshot : {};
  const list = Array.isArray(snap.regex_scripts) ? snap.regex_scripts : [];
  const lines = [];

  lines.push("regex_scripts/");
  if (list.length === 0) {
    lines.push("  - （空）");
    return lines.join("\n").trim();
  }

  const { items, more } = takeWithMore(list, 80);
  lines.push(`  - ${list.length} items`);
  items.forEach((s, idx) => {
    const name = safeNameOrIndex(s?.name, idx);
    const enabled = formatBool(Boolean(s?.enabled));
    lines.push(`    - ${name}: enabled=${enabled}`);
  });
  if (more > 0) lines.push(`    - … and ${more} more`);

  return lines.join("\n").trim();
}

export function buildTavernHelperIndexText(snapshot) {
  const snap = isPlainObject(snapshot) ? snapshot : {};
  const th = isPlainObject(snap.tavern_helper) ? snap.tavern_helper : {};
  const scripts = Array.isArray(th.scripts) ? th.scripts : [];
  const vars = isPlainObject(th.variables) ? th.variables : {};
  const varKeys = Object.keys(vars);
  const lines = [];

  lines.push("tavern_helper/");

  if (scripts.length === 0) {
    lines.push("  - scripts/: （空）");
  } else {
    const { items, more } = takeWithMore(scripts, 60);
    lines.push(`  - scripts/: ${scripts.length} items`);
    items.forEach((s, idx) => {
      const name = safeNameOrIndex(s?.name || s?.id, idx);
      const enabled = formatBool(Boolean(s?.enabled));
      const len = lenOrEmptyMark(toStringOrEmpty(s?.content));
      lines.push(`    - ${name}: enabled=${enabled}, len=${len}`);
    });
    if (more > 0) lines.push(`    - … and ${more} more`);
  }

  if (varKeys.length === 0) {
    lines.push("  - variables/: （空）");
  } else {
    const { items, more } = takeWithMore(varKeys, 40);
    lines.push(`  - variables/: ${varKeys.length} keys`);
    items.forEach((k) => lines.push(`    - ${normalizePathSegment(k)}`));
    if (more > 0) lines.push(`    - … and ${more} more`);
  }

  return lines.join("\n").trim();
}

/**
 * 中文注释：
 * buildVcardReadIndexText(snapshot)
 * 作用：生成“可读条目索引”总览（仅目录/元信息，不包含正文内容）
 * 返回：string
 */
export function buildVcardReadIndexText(snapshot) {
  const snap = isPlainObject(snapshot) ? snapshot : {};
  const root = pickRootName(snap);

  const lines = [];
  lines.push("【VCARD：可读条目索引】");
  lines.push("");
  lines.push(`${root}/`);
  lines.push(indentLines(buildCardIndexText(snap), 2));
  lines.push("");
  lines.push(indentLines(buildWorldbookIndexText(snap), 2));
  lines.push("");
  lines.push(indentLines(buildRegexScriptsIndexText(snap), 2));
  lines.push("");
  lines.push(indentLines(buildTavernHelperIndexText(snap), 2));
  lines.push("");
  lines.push("提示：标记为“（空）”的条目无需 read；需要正文时再按路径读取对应文件/条目。");

  return lines.join("\n").trim();
}

function indentLines(text, spaces) {
  const pad = " ".repeat(Math.max(0, Number(spaces) || 0));
  return String(text || "")
    .split("\n")
    .map((l) => (l ? `${pad}${l}` : l))
    .join("\n");
}

