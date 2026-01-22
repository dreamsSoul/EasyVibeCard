/**
 * 文件：buildReadResultText.js
 * 模块：server/entities/vcard/readProtocol
 * 作用：从快照读取指定 path 片段，并生成【VCARD_READ_RESULT】文本
 * 依赖：constants、utils
 * @created 2026-01-08
 * @modified 2026-01-21
 */

import { CARD_FILE_KEYS, DEFAULT_LIMIT, MAX_LIMIT, VCARD_READ_RESULT_PREFIX } from "./constants.js";
import { buildRegexScriptsIndexText, buildTavernHelperIndexText, buildVcardReadIndexText, buildWorldbookIndexText } from "./indexText.js";
import { clampInt, isPlainObject, normalizePathSegment, normalizeReadPath, parseIndexSegment, toStringOrEmpty } from "./utils.js";

function pickRootName(snapshot) {
  const name = normalizePathSegment(snapshot?.card?.name);
  return name || "角色名";
}

function parseFilePath(path, rootName) {
  const raw = normalizeReadPath(path);
  if (!raw) return { ok: false, error: "path 为空。" };

  const parts = raw
    .replace(/\\/g, "/")
    .split("/")
    .map((p) => normalizePathSegment(p))
    .filter((p) => p.length > 0);
  if (parts.length === 0) return { ok: false, error: "path 为空。" };

  const root = normalizePathSegment(rootName);
  const aliases = new Set([root, "角色名", "角色卡"]);
  if (parts.length > 0 && aliases.has(parts[0])) parts.shift();
  if (parts.length === 0) return { ok: true, parts: [] };
  return { ok: true, parts };
}

function parseDotPath(path) {
  const raw = String(path || "").trim();
  if (!raw) return null;
  return raw.split(".").map((part) => {
    const m = String(part || "").match(/^([a-zA-Z0-9_]+)(?:\[(\d+)\])?$/);
    if (!m) return null;
    return { key: m[1], index: m[2] === undefined ? null : Number(m[2]) };
  });
}

function getBySegments(obj, segments) {
  let cur = obj;
  for (const seg of segments) {
    if (!seg) return { ok: false, error: "path 非法。" };
    if (!cur || typeof cur !== "object") return { ok: false, error: `path 越界：${seg.key}` };
    if (!(seg.key in cur)) return { ok: false, error: `path 不存在：${seg.key}` };
    cur = cur[seg.key];
    if (seg.index !== null) {
      if (!Array.isArray(cur)) return { ok: false, error: `path 期望数组：${seg.key}` };
      const i = seg.index;
      if (!Number.isFinite(i) || i < 0 || i >= cur.length) return { ok: false, error: `path 索引越界：${seg.key}[${i}]` };
      cur = cur[i];
    }
  }
  return { ok: true, value: cur };
}

function pickItemByNameOrIndex(list, segment, getName) {
  const items = Array.isArray(list) ? list : [];
  const idx = parseIndexSegment(segment);
  if (idx !== null) {
    if (idx < 0 || idx >= items.length) return { ok: false, error: `path 索引越界：${segment}` };
    return { ok: true, index: idx, item: items[idx] };
  }
  const target = normalizePathSegment(segment);
  const found = items.findIndex((x) => normalizePathSegment(getName(x)) === target);
  if (found < 0) return { ok: false, error: `path 不存在：${segment}` };
  return { ok: true, index: found, item: items[found] };
}

function getByFileSegments(value, segments) {
  let cur = value;
  for (const seg of Array.isArray(segments) ? segments : []) {
    const idx = parseIndexSegment(seg);
    if (idx !== null) {
      if (!Array.isArray(cur)) return { ok: false, error: `path 期望数组：${seg}` };
      if (idx < 0 || idx >= cur.length) return { ok: false, error: `path 索引越界：${seg}` };
      cur = cur[idx];
      continue;
    }
    if (!cur || typeof cur !== "object") return { ok: false, error: `path 非法：${seg}` };
    if (!(seg in cur)) return { ok: false, error: `path 不存在：${seg}` };
    cur = cur[seg];
  }
  return { ok: true, value: cur };
}

function resolveCardFile(snapshot, parts) {
  const key = parts[0];
  if (!CARD_FILE_KEYS.has(key)) return { ok: false, error: `path 不存在：${key}` };
  if (parts.length > 1) return { ok: false, error: `path 过深：${parts.join("/")}` };
  return { ok: true, value: toStringOrEmpty(snapshot?.card?.[key]) };
}

function resolveAlternateGreetings(snapshot, parts) {
  if (parts.length === 0) return { ok: false, error: "path 不完整：alternate_greetings" };
  const list = Array.isArray(snapshot?.card?.alternate_greetings) ? snapshot.card.alternate_greetings : [];
  const idx = parseIndexSegment(parts[0]);
  if (idx === null) return { ok: false, error: `path 期望索引：${parts[0]}` };
  if (idx < 0 || idx >= list.length) return { ok: false, error: `path 索引越界：${parts[0]}` };
  if (parts.length > 1) return { ok: false, error: `path 过深：${parts.join("/")}` };
  return { ok: true, value: toStringOrEmpty(list[idx]) };
}

function resolveWorldbookFile(snapshot, parts) {
  if (parts.length === 0) return { ok: true, value: buildWorldbookIndexText(snapshot) };
  const entries = Array.isArray(snapshot?.worldbook?.entries) ? snapshot.worldbook.entries : [];
  const picked = pickItemByNameOrIndex(entries, parts[0], (e) => e?.comment);
  if (!picked.ok) return picked;
  if (parts.length === 1) return { ok: true, value: toStringOrEmpty(picked.item?.content) };
  const sub = getByFileSegments(picked.item, parts.slice(1));
  if (!sub.ok) return sub;
  return { ok: true, value: sub.value };
}

function resolveRegexScriptFile(snapshot, parts) {
  if (parts.length === 0) return { ok: true, value: buildRegexScriptsIndexText(snapshot) };
  const scripts = Array.isArray(snapshot?.regex_scripts) ? snapshot.regex_scripts : [];
  const picked = pickItemByNameOrIndex(scripts, parts[0], (s) => s?.name);
  if (!picked.ok) return picked;
  if (parts.length === 1) return { ok: true, value: picked.item };
  const sub = getByFileSegments(picked.item, parts.slice(1));
  if (!sub.ok) return sub;
  return { ok: true, value: sub.value };
}

function resolveTavernHelperFile(snapshot, parts) {
  if (parts.length === 0) return { ok: true, value: buildTavernHelperIndexText(snapshot) };
  if (parts.length === 1) return { ok: true, value: buildTavernHelperIndexText(snapshot) };
  const area = parts[0];

  if (area === "scripts") {
    const scripts = Array.isArray(snapshot?.tavern_helper?.scripts) ? snapshot.tavern_helper.scripts : [];
    const picked = pickItemByNameOrIndex(scripts, parts[1], (s) => s?.name || s?.id);
    if (!picked.ok) return picked;
    if (parts.length === 2) return { ok: true, value: toStringOrEmpty(picked.item?.content) };
    const sub = getByFileSegments(picked.item, parts.slice(2));
    if (!sub.ok) return sub;
    return { ok: true, value: sub.value };
  }

  if (area === "variables") {
    const vars = isPlainObject(snapshot?.tavern_helper?.variables) ? snapshot.tavern_helper.variables : {};
    const key = parts[1];
    let pickedKey = key;
    if (!(pickedKey in vars)) {
      pickedKey = Object.keys(vars).find((k) => normalizePathSegment(k) === normalizePathSegment(key)) || "";
    }
    if (!pickedKey || !(pickedKey in vars)) return { ok: false, error: `path 不存在：${key}` };
    if (parts.length > 2) return { ok: false, error: `path 过深：${parts.join("/")}` };
    return { ok: true, value: vars[pickedKey] };
  }

  return { ok: false, error: `path 不存在：${area}` };
}

function resolveFileContentFromSnapshot(snapshot, path) {
  const rootName = pickRootName(snapshot);
  const parsed = parseFilePath(path, rootName);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  if (parsed.parts.length === 0) return { ok: true, value: buildVcardReadIndexText(snapshot) };

  const [head, ...rest] = parsed.parts;
  if (CARD_FILE_KEYS.has(head)) return resolveCardFile(snapshot, [head, ...rest]);
  if (head === "alternate_greetings") return resolveAlternateGreetings(snapshot, rest);
  if (head === "worldbook") return resolveWorldbookFile(snapshot, rest);
  if (head === "regex_scripts") return resolveRegexScriptFile(snapshot, rest);
  if (head === "tavern_helper") return resolveTavernHelperFile(snapshot, rest);
  return { ok: false, error: `path 不存在：${head}` };
}

function buildReadItemFromValue(value, read) {
  if (typeof value === "string") {
    const offset = clampInt(read.offset, { min: 0, max: value.length, fallback: 0 });
    const limit = clampInt(read.limit, { min: 1, max: MAX_LIMIT, fallback: DEFAULT_LIMIT });
    const sliced = value.slice(offset, offset + limit);
    const nextOffset = offset + limit;
    return {
      path: read.path,
      type: "string",
      offset,
      limit,
      totalLen: value.length,
      hasMore: nextOffset < value.length,
      nextOffset: nextOffset < value.length ? nextOffset : null,
      value: sliced,
    };
  }

  const json = JSON.stringify(value);
  if (json.length > read.limit) {
    return {
      path: read.path,
      type: Array.isArray(value) ? "array" : typeof value,
      approxLen: json.length,
      error: "对象过大：请读取更具体的子路径。",
    };
  }

  return { path: read.path, type: Array.isArray(value) ? "array" : typeof value, value };
}

function readOneValue(snapshot, read) {
  const rawPath = String(read.path || "");
  if (rawPath.includes("/") || rawPath.includes("\\")) {
    const resolved = resolveFileContentFromSnapshot(snapshot, read.path);
    if (!resolved.ok) return { path: read.path, error: resolved.error };
    return buildReadItemFromValue(resolved.value, read);
  }

  const segments = parseDotPath(read.path);
  if (!segments || segments.some((x) => !x)) return { path: read.path, error: "path 非法（仅支持 点分段 key 与单索引 [i]）。" };
  const root = segments[0]?.key;
  if (!["card", "worldbook", "regex_scripts", "tavern_helper", "raw"].includes(String(root || ""))) {
    return { path: read.path, error: `不允许的根路径：${String(root || "")}` };
  }

  const got = getBySegments(snapshot, segments);
  if (!got.ok) return { path: read.path, error: got.error };
  return buildReadItemFromValue(got.value, read);
}

function buildReadableSnapshot(draft, { includeVibePlan }) {
  const rawExt = isPlainObject(draft?.raw?.dataExtensions) ? draft.raw.dataExtensions : {};
  const dataExtensions = includeVibePlan
    ? { ...rawExt }
    : (() => {
        const next = { ...rawExt };
        delete next.vibePlan;
        return next;
      })();

  return {
    card: isPlainObject(draft?.card) ? draft.card : {},
    worldbook: isPlainObject(draft?.worldbook) ? draft.worldbook : { name: "", entries: [] },
    regex_scripts: Array.isArray(draft?.regex_scripts) ? draft.regex_scripts : [],
    tavern_helper: isPlainObject(draft?.tavern_helper) ? draft.tavern_helper : { scripts: [], variables: {} },
    raw: { dataExtensions },
  };
}

/**
 * 中文注释：
 * buildReadResultText({ draft, reads, includeVibePlan })
 * 作用：从草稿中读取指定 path 的片段，并生成【VCARD_READ_RESULT】消息文本
 * 约束：请求级（不持久化）；limit/reads 数量已在 normalizeReadRequest 侧限制
 * 参数：
 *  - draft: object（CardDraft 快照）
 *  - reads: {path:string,offset:number,limit:number}[]
 *  - includeVibePlan: boolean（是否允许读取 vibePlan）
 *  - meta?: object（可选元信息：用于标记 baseVersion/round 等，不影响解析）
 * 返回：string
 */
export function buildReadResultText({ draft, reads, includeVibePlan, meta }) {
  const snapshot = buildReadableSnapshot(draft, { includeVibePlan: Boolean(includeVibePlan) });
  const items = [];
  for (const r of Array.isArray(reads) ? reads : []) items.push(readOneValue(snapshot, r));

  const metaObj = meta && typeof meta === "object" && !Array.isArray(meta) ? meta : null;
  const payload = metaObj ? { kind: "read.result", meta: metaObj, items } : { kind: "read.result", items };
  return [VCARD_READ_RESULT_PREFIX, "```json", JSON.stringify(payload, null, 2), "```"].join("\n");
}
