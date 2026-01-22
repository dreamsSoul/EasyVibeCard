/**
 * 文件：worldbookTarget.js
 * 模块：server/entities/vcard
 * 作用：把 AI 输出的 worldbook 目标态（after）转换为可应用的 worldbook.patch（程序生成 diff）
 * 依赖：无
 * @created 2026-01-08
 * @modified 2026-01-08
 */

const WORLDBOOK_POSITION_KEYS = Object.freeze([
  "before_char",
  "after_char",
  "before_author_note",
  "after_author_note",
  "at_depth_system",
  "at_depth_user",
  "at_depth_assistant",
  "before_example_messages",
  "after_example_messages",
  "outlet",
]);

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function toPlainObject(value) {
  return isPlainObject(value) ? value : null;
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

function isWorldbookPositionKey(value) {
  return WORLDBOOK_POSITION_KEYS.includes(String(value || ""));
}

function isAtDepthPositionKey(value) {
  const k = String(value || "");
  return k === "at_depth_system" || k === "at_depth_user" || k === "at_depth_assistant";
}

function normalizeAtDepth(value) {
  const obj = toPlainObject(value) || {};
  const depth = toIntOrNull(obj.depth);
  return depth === null ? null : { depth: Math.max(0, depth) };
}

function normalizeWorldbookEntryLite(raw) {
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

function toIdKey(id) {
  if (id === null || id === undefined) return "";
  return String(id);
}

function buildUniqueIndexById(entries) {
  const map = new Map();
  const list = Array.isArray(entries) ? entries : [];
  for (const e of list) {
    const key = toIdKey(e?.id);
    if (!key) continue;
    if (map.has(key)) return { ok: false, map: new Map() };
    map.set(key, e);
  }
  return { ok: true, map };
}

function normalizeWorldbookTarget(raw) {
  const obj = isPlainObject(raw) ? raw : null;
  if (!obj) return { ok: false, error: "worldbook.target 缺少 worldbook 对象。", worldbook: null };
  const entriesRaw = obj.entries;
  if (!Array.isArray(entriesRaw)) return { ok: false, error: "worldbook.target 要求 worldbook.entries 为数组且必须全量提供。", worldbook: null };
  const name = String(obj.name || "");
  const entries = entriesRaw.map(normalizeWorldbookEntryLite);
  return { ok: true, error: "", worldbook: { name, entries } };
}

function mergeRawExtensionsFromBefore(beforeEntries, afterEntries) {
  const idx = buildUniqueIndexById(beforeEntries);
  if (!idx.ok) return afterEntries;

  return afterEntries.map((e) => {
    const key = toIdKey(e?.id);
    if (!key) return e;
    const before = idx.map.get(key);
    const hasRaw = before && typeof before === "object" && before.raw_extensions && typeof before.raw_extensions === "object" && !Array.isArray(before.raw_extensions);
    if (!hasRaw) return e;
    if (e && typeof e === "object" && e.raw_extensions && typeof e.raw_extensions === "object") return e;
    return { ...e, raw_extensions: before.raw_extensions };
  });
}

/**
 * 中文注释：
 * buildWorldbookPatchFromTarget({ beforeWorldbook, targetWorldbook })
 * 作用：将目标态 worldbook 转成 patch（通常为 name + entries 整包 set）
 * 约束：targetWorldbook.entries 必须全量提供；会尽力保留 before 的 raw_extensions（按 id 匹配）
 * 参数：
 *  - beforeWorldbook: { name:string, entries:object[] }
 *  - targetWorldbook: any（AI 输出 worldbook）
 * 返回：{ ok:boolean, error?:string, patch?:object[] }
 */
export function buildWorldbookPatchFromTarget({ beforeWorldbook, targetWorldbook }) {
  const before = isPlainObject(beforeWorldbook) ? beforeWorldbook : { name: "", entries: [] };
  const beforeEntries = Array.isArray(before.entries) ? before.entries : [];

  const normalized = normalizeWorldbookTarget(targetWorldbook);
  if (!normalized.ok) return { ok: false, error: normalized.error || "worldbook.target 非法。", patch: null };

  const after = normalized.worldbook;
  const mergedEntries = mergeRawExtensionsFromBefore(beforeEntries, after.entries);
  const patch = [];
  if (String(before.name || "") !== String(after.name || "")) patch.push({ op: "set", path: "worldbook.name", value: after.name });
  patch.push({ op: "set", path: "worldbook.entries", value: mergedEntries });
  return { ok: true, error: "", patch };
}

