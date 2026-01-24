/**
 * 文件：fullText.js
 * 模块：server/entities/vcard/readProtocol
 * 作用：构建“角色卡全文注入”文本（按 read 路径标识每个条目）
 * 依赖：utils
 * @created 2026-01-21
 * @modified 2026-01-24
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

function escapeInline(text) {
  return String(text ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll('"', '\\"')
    .trim();
}

function utf8Bytes(text) {
  return Buffer.byteLength(String(text ?? ""), "utf8");
}

/**
 * 中文注释：
 * estimateTokens(text)
 * 作用：对文本做“保守”的 token 估算（用于是否注入全文的阈值判断）
 * 约束：不追求与任何特定模型完全一致；宁可略高估避免超量注入
 * 参数：
 *  - text: string
 * 返回：number（>=0）
 */
export function estimateTokens(text) {
  const bytes = utf8Bytes(text);
  // 经验上：UTF-8 约 3 bytes ≈ 1 token（对中英文都偏保守/略高估）
  return Math.ceil(bytes / 3);
}

function pushEntry(lines, { path, meta, value }) {
  const p = String(path || "").trim();
  if (!p) return;
  const m = String(meta || "").trim();
  const header = m ? `【${p} ${m}】` : `【${p}】`;
  lines.push(header);
  const text = String(value ?? "");
  lines.push(text.trim() ? text : "（空）");
  lines.push("");
}

function buildCardFullText(snapshot, root) {
  const snap = isPlainObject(snapshot) ? snapshot : {};
  const card = isPlainObject(snap.card) ? snap.card : {};
  const lines = [];

  for (const key of CARD_TEXT_KEYS) {
    pushEntry(lines, { path: `${root}/${key}`, value: toStringOrEmpty(card?.[key]) });
  }

  const ag = Array.isArray(card?.alternate_greetings) ? card.alternate_greetings : [];
  if (ag.length === 0) {
    pushEntry(lines, { path: `${root}/alternate_greetings/`, value: "（空）" });
    return lines;
  }
  ag.forEach((x, i) => pushEntry(lines, { path: `${root}/alternate_greetings/[${i}]`, value: toStringOrEmpty(x) }));
  return lines;
}

function buildWorldbookFullText(snapshot, root) {
  const snap = isPlainObject(snapshot) ? snapshot : {};
  const wb = isPlainObject(snap.worldbook) ? snap.worldbook : {};
  const entries = Array.isArray(wb.entries) ? wb.entries : [];
  const lines = [];

  pushEntry(lines, { path: `${root}/worldbook/name`, value: normalizePathSegment(wb?.name) || "（空）" });
  if (entries.length === 0) {
    pushEntry(lines, { path: `${root}/worldbook/entries/`, value: "（空）" });
    return lines;
  }

  entries.forEach((e, idx) => {
    const comment = normalizePathSegment(e?.comment);
    const enabled = Boolean(e?.enabled);
    const position = normalizePathSegment(e?.position);
    const metaParts = [];
    if (comment) metaParts.push(`comment="${escapeInline(comment)}"`);
    metaParts.push(`enabled=${enabled ? "true" : "false"}`);
    if (position) metaParts.push(`position="${escapeInline(position)}"`);
    pushEntry(lines, { path: `${root}/worldbook/[${idx}]`, meta: metaParts.join(" "), value: toStringOrEmpty(e?.content) });
  });
  return lines;
}

function buildRegexScriptsFullText(snapshot, root) {
  const snap = isPlainObject(snapshot) ? snapshot : {};
  const list = Array.isArray(snap.regex_scripts) ? snap.regex_scripts : [];
  const lines = [];

  if (list.length === 0) {
    pushEntry(lines, { path: `${root}/regex_scripts/`, value: "（空）" });
    return lines;
  }

  list.forEach((s, idx) => {
    const name = normalizePathSegment(s?.name);
    const enabled = Boolean(s?.enabled);
    const placement = Array.isArray(s?.placement) ? s.placement : [];
    const metaParts = [];
    if (name) metaParts.push(`name="${escapeInline(name)}"`);
    metaParts.push(`enabled=${enabled ? "true" : "false"}`);
    if (placement.length > 0) metaParts.push(`placement=${JSON.stringify(placement)}`);

    // 直接给出条目 JSON，保留字段信息（便于模型精确引用/生成 patch）
    pushEntry(lines, { path: `${root}/regex_scripts/[${idx}]`, meta: metaParts.join(" "), value: JSON.stringify(s ?? {}, null, 2) });
  });
  return lines;
}

function buildTavernHelperFullText(snapshot, root) {
  const snap = isPlainObject(snapshot) ? snapshot : {};
  const th = isPlainObject(snap.tavern_helper) ? snap.tavern_helper : {};
  const scripts = Array.isArray(th.scripts) ? th.scripts : [];
  const vars = isPlainObject(th.variables) ? th.variables : {};
  const varKeys = Object.keys(vars);
  const lines = [];

  if (scripts.length === 0) {
    pushEntry(lines, { path: `${root}/tavern_helper/scripts/`, value: "（空）" });
  } else {
    scripts.forEach((s, idx) => {
      const name = normalizePathSegment(s?.name || s?.id);
      const enabled = Boolean(s?.enabled);
      const metaParts = [];
      if (name) metaParts.push(`name="${escapeInline(name)}"`);
      metaParts.push(`enabled=${enabled ? "true" : "false"}`);
      pushEntry(lines, { path: `${root}/tavern_helper/scripts/[${idx}]`, meta: metaParts.join(" "), value: toStringOrEmpty(s?.content) });
    });
  }

  if (varKeys.length === 0) {
    pushEntry(lines, { path: `${root}/tavern_helper/variables/`, value: "（空）" });
  } else {
    varKeys.forEach((k) => pushEntry(lines, { path: `${root}/tavern_helper/variables/${normalizePathSegment(k)}`, value: JSON.stringify(vars[k], null, 2) }));
  }

  return lines;
}

/**
 * 中文注释：
 * buildVcardFullText(snapshot)
 * 作用：生成“角色卡全文”文本，且每个条目带明确的 read 路径标识
 * 约束：不做 token 截断
 * 参数：
 *  - snapshot: object（CardDraft 快照/可读快照）
 * 返回：string
 */
export function buildVcardFullText(snapshot) {
  const snap = isPlainObject(snapshot) ? snapshot : {};
  const root = pickRootName(snap);
  const lines = [];

  lines.push("【VCARD：全文（自动注入）】");
  lines.push(`root="${escapeInline(root)}"`);
  lines.push("");
  lines.push("说明：以下为角色卡正文快照（按路径标注），用于理解现状与定位 read/patch path。请不要在输出中复述/复制本段内容（除非用户明确要求逐字引用/复写）。");
  lines.push("");

  lines.push("【card/】");
  lines.push("");
  lines.push(...buildCardFullText(snap, root));

  lines.push("【worldbook/】");
  lines.push("");
  lines.push(...buildWorldbookFullText(snap, root));

  lines.push("【regex_scripts/】");
  lines.push("");
  lines.push(...buildRegexScriptsFullText(snap, root));

  lines.push("【tavern_helper/】");
  lines.push("");
  lines.push(...buildTavernHelperFullText(snap, root));

  // 闭合标记：用于让模型与用户明确“全文注入”段落范围。
  lines.push("【/VCARD：全文（自动注入）】");

  return lines.join("\n").trim();
}

/**
 * 中文注释：
 * buildVcardAutoFullText(snapshot, opts)
 * 作用：返回全文注入文本
 * 说明：当前版本默认总是注入全文；若后续需要“超长不注入/截断”，再引入 tokenLimit 策略
 * 参数：
 *  - snapshot: object
 *  - opts?: { tokenLimit?: number }
 * 返回：string（为空表示不注入）
 */
export function buildVcardAutoFullText(snapshot, opts = {}) {
  void opts;
  return buildVcardFullText(snapshot);
}
