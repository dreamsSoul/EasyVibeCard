/**
 * 文件：applyPreview.js
 * 模块：server/entities/vcard
 * 作用：生成“待确认变更”的 Before/After 预览（用于 Patch 预览审批）
 * 依赖：无
 * @created 2026-01-17
 * @modified 2026-01-17
 */

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function toStringArray(value) {
  return (Array.isArray(value) ? value : [])
    .map((x) => String(x ?? "").trim())
    .filter(Boolean);
}

function clipText(text, maxChars) {
  const s = String(text || "");
  const limit = Math.max(40, Number(maxChars) || 1200);
  if (s.length <= limit) return s;
  return `${s.slice(0, limit)}\n…（已截断，${s.length} chars）`;
}

function pickEntryTitle(entry, idx) {
  const e = isPlainObject(entry) ? entry : {};
  const comment = String(e.comment || "").trim();
  if (comment) return comment;
  const id = String(e.id ?? "").trim();
  if (id) return id;
  return `#${Number(idx) + 1}`;
}

function toIdKey(id) {
  if (id === null || id === undefined) return "";
  const s = String(id).trim();
  return s;
}

function buildUniqueIdIndex(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const map = new Map();
  const order = [];
  for (let i = 0; i < list.length; i += 1) {
    const e = list[i];
    const key = toIdKey(e?.id);
    if (!key) return { ok: false, map: new Map(), order: [] };
    if (map.has(key)) return { ok: false, map: new Map(), order: [] };
    map.set(key, { entry: e, index: i });
    order.push(key);
  }
  return { ok: true, map, order };
}

function sameStringArray(a, b) {
  const x = toStringArray(a);
  const y = toStringArray(b);
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return false;
  return true;
}

function pickAtDepthValue(e) {
  const d = e?.at_depth;
  if (!d || typeof d !== "object") return null;
  const n = Number(d.depth);
  return Number.isFinite(n) ? n : null;
}

function isEntryEquivalent(beforeEntry, afterEntry) {
  const b = isPlainObject(beforeEntry) ? beforeEntry : {};
  const a = isPlainObject(afterEntry) ? afterEntry : {};
  if (String(b.comment || "") !== String(a.comment || "")) return false;
  if (String(b.content || "") !== String(a.content || "")) return false;
  if (Boolean(b.enabled) !== Boolean(a.enabled)) return false;
  if (String(b.light || "blue") !== String(a.light || "blue")) return false;
  if (String(b.position || "") !== String(a.position || "")) return false;
  if (String(b.secondary_logic || "and_any") !== String(a.secondary_logic || "and_any")) return false;
  if (Number(b.order) !== Number(a.order)) return false;
  if (Boolean(b.use_regex) !== Boolean(a.use_regex)) return false;
  if (!sameStringArray(b.keys, a.keys)) return false;
  if (!sameStringArray(b.secondary_keys, a.secondary_keys)) return false;
  if (pickAtDepthValue(b) !== pickAtDepthValue(a)) return false;
  return true;
}

function diffEntryFields(beforeEntry, afterEntry) {
  const b = isPlainObject(beforeEntry) ? beforeEntry : {};
  const a = isPlainObject(afterEntry) ? afterEntry : {};
  const fields = [];
  const pushIf = (cond, name) => {
    if (cond) fields.push(name);
  };
  pushIf(String(b.comment || "") !== String(a.comment || ""), "comment");
  pushIf(String(b.content || "") !== String(a.content || ""), "content");
  pushIf(Boolean(b.enabled) !== Boolean(a.enabled), "enabled");
  pushIf(String(b.light || "blue") !== String(a.light || "blue"), "light");
  pushIf(String(b.position || "") !== String(a.position || ""), "position");
  pushIf(String(b.secondary_logic || "and_any") !== String(a.secondary_logic || "and_any"), "secondary_logic");
  pushIf(Number(b.order) !== Number(a.order), "order");
  pushIf(Boolean(b.use_regex) !== Boolean(a.use_regex), "use_regex");
  pushIf(!sameStringArray(b.keys, a.keys), "keys");
  pushIf(!sameStringArray(b.secondary_keys, a.secondary_keys), "secondary_keys");
  pushIf(pickAtDepthValue(b) !== pickAtDepthValue(a), "at_depth");
  return fields;
}

function summarizeEntry(entry) {
  const e = isPlainObject(entry) ? entry : null;
  if (!e) return "（条目不存在）";

  const keys = toStringArray(e.keys);
  const secondaryKeys = toStringArray(e.secondary_keys);
  const head = [
    `id: ${String(e.id ?? "")}`,
    `comment: ${String(e.comment || "")}`,
    `enabled: ${Boolean(e.enabled) ? "true" : "false"}`,
    `light: ${String(e.light || "blue")}`,
    `position: ${String(e.position || "")}`,
    Number.isFinite(Number(e.order)) ? `order: ${Number(e.order)}` : "",
    e.at_depth && typeof e.at_depth === "object" && Number.isFinite(Number(e.at_depth.depth)) ? `at_depth.depth: ${Number(e.at_depth.depth)}` : "",
    keys.length ? `keys: ${keys.join(", ")}` : "",
    secondaryKeys.length ? `secondary_keys: ${secondaryKeys.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const content = clipText(String(e.content || ""), 1400);
  return [head, "", "content:", content].join("\n").trim();
}

function pickChangedEntryIndices(changedPaths) {
  const list = Array.isArray(changedPaths) ? changedPaths : [];
  const out = new Set();
  for (const p of list) {
    const m = String(p || "").match(/^worldbook\.entries\[(\d+)\]/);
    if (!m) continue;
    out.add(Number(m[1]));
  }
  return Array.from(out)
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
}

function pickChangedFieldsForEntry(changedPaths, idx) {
  const list = Array.isArray(changedPaths) ? changedPaths : [];
  const prefix = `worldbook.entries[${Number(idx)}]`;
  const fields = new Set();
  for (const p of list) {
    const s = String(p || "");
    if (!s.startsWith(prefix)) continue;
    const rest = s.slice(prefix.length);
    if (!rest) fields.add("(entry)");
    else if (rest.startsWith(".")) fields.add(rest.slice(1).split(".")[0]);
    else fields.add("(entry)");
  }
  return Array.from(fields).sort();
}

function makeAddedEntryDiff(afterHit) {
  return {
    type: "added",
    beforeIdx: undefined,
    afterIdx: afterHit.index,
    idx: afterHit.index,
    title: pickEntryTitle(afterHit.entry, afterHit.index),
    fields: ["(added)"],
    beforeText: "（不存在）",
    afterText: summarizeEntry(afterHit.entry),
  };
}

function makeModifiedEntryDiff(beforeHit, afterHit) {
  return {
    type: "modified",
    beforeIdx: beforeHit.index,
    afterIdx: afterHit.index,
    idx: afterHit.index,
    title: pickEntryTitle(afterHit.entry || beforeHit.entry, afterHit.index),
    fields: diffEntryFields(beforeHit.entry, afterHit.entry),
    beforeText: summarizeEntry(beforeHit.entry),
    afterText: summarizeEntry(afterHit.entry),
  };
}

function makeRemovedEntryDiff(beforeHit) {
  return {
    type: "removed",
    beforeIdx: beforeHit.index,
    afterIdx: undefined,
    idx: beforeHit.index,
    title: pickEntryTitle(beforeHit.entry, beforeHit.index),
    fields: ["(removed)"],
    beforeText: summarizeEntry(beforeHit.entry),
    afterText: "（已删除）",
  };
}

function buildWorldbookEntryDiffsByUniqueId({ beforeEntries, afterEntries, limit }) {
  const beforeIdx = buildUniqueIdIndex(beforeEntries);
  const afterIdx = buildUniqueIdIndex(afterEntries);
  if (!beforeIdx.ok || !afterIdx.ok) return { ok: false, diffs: [] };

  const diffs = [];
  const seen = new Set();

  for (const id of afterIdx.order) {
    const afterHit = afterIdx.map.get(id);
    const beforeHit = beforeIdx.map.get(id);
    if (!afterHit) continue;
    if (!beforeHit) diffs.push(makeAddedEntryDiff(afterHit));
    else if (!isEntryEquivalent(beforeHit.entry, afterHit.entry)) diffs.push(makeModifiedEntryDiff(beforeHit, afterHit));
    seen.add(id);
  }

  for (const id of beforeIdx.order) {
    if (seen.has(id)) continue;
    const beforeHit = beforeIdx.map.get(id);
    if (beforeHit) diffs.push(makeRemovedEntryDiff(beforeHit));
  }

  return { ok: true, diffs: diffs.slice(0, Math.max(1, Number(limit) || 12)) };
}

function buildWorldbookEntryDiffsByChangedPaths({ beforeEntries, afterEntries, changedPaths, limit }) {
  const idxs = pickChangedEntryIndices(changedPaths).slice(0, Math.max(1, Number(limit) || 12));
  return idxs.map((idx) => {
    const beforeEntry = beforeEntries[idx] ?? null;
    const afterEntry = afterEntries[idx] ?? null;
    const title = pickEntryTitle(afterEntry || beforeEntry, idx);
    const fields = pickChangedFieldsForEntry(changedPaths, idx);
    return {
      type: "modified",
      beforeIdx: idx,
      afterIdx: idx,
      idx,
      title,
      fields,
      beforeText: summarizeEntry(beforeEntry),
      afterText: summarizeEntry(afterEntry),
    };
  });
}

/**
 * 中文注释：
 * buildVcardApplyPreview({ beforeDraft, afterDraft, changedPaths })
 * 作用：为 UI 构建“世界书变更”的 Before/After 预览（减少手动搜索）
 * 约束：只做轻量预览；content 做截断；最多返回 12 条条目变更
 * 参数：
 *  - beforeDraft: object
 *  - afterDraft: object
 *  - changedPaths: string[]
 * 返回：{ worldbookName?:{before:string,after:string}, worldbookEntryDiffs:{type:string,idx:number,beforeIdx?:number,afterIdx?:number,title:string,fields:string[],beforeText:string,afterText:string}[] }
 */
export function buildVcardApplyPreview({ beforeDraft, afterDraft, changedPaths }) {
  const beforeName = String(beforeDraft?.worldbook?.name || "");
  const afterName = String(afterDraft?.worldbook?.name || "");
  const worldbookName = beforeName !== afterName ? { before: beforeName, after: afterName } : null;

  const beforeEntries = Array.isArray(beforeDraft?.worldbook?.entries) ? beforeDraft.worldbook.entries : [];
  const afterEntries = Array.isArray(afterDraft?.worldbook?.entries) ? afterDraft.worldbook.entries : [];
  const byId = buildWorldbookEntryDiffsByUniqueId({ beforeEntries, afterEntries, limit: 12 });
  const worldbookEntryDiffs = byId.ok ? byId.diffs : buildWorldbookEntryDiffsByChangedPaths({ beforeEntries, afterEntries, changedPaths, limit: 12 });

  return { worldbookName: worldbookName || undefined, worldbookEntryDiffs: worldbookEntryDiffs || [] };
}

