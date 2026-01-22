/**
 * 文件：readProtocol.js
 * 模块：vcard/domain
 * 作用：实现 kind=read 的请求归一化与本地读取（用于大草稿分片补充上下文）
 * 依赖：cardDraft
 * @created 2026-01-03
 * @modified 2026-01-05
 */

import { normalizeCardDraft } from "./cardDraft";

export const VCARD_READ_PREFIX = "【VCARD_READ】";
export const VCARD_READ_RESULT_PREFIX = "【VCARD_READ_RESULT】";

const DEFAULT_LIMIT = 1200;
const MAX_LIMIT = 6000;
const MAX_READS = 8;
const CARD_FILE_KEYS = new Set([
  "description",
  "personality",
  "scenario",
  "first_mes",
  "mes_example",
  "system_prompt",
  "creator_notes",
  "post_history_instructions",
]);

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function toIntOr(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function toStringOrEmpty(value) {
  return String(value ?? "");
}

function normalizeReadPath(value) {
  return String(value ?? "").trim();
}

function clampInt(value, { min, max, fallback }) {
  const n = toIntOr(value, fallback);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function normalizePathSegment(value) {
  return String(value ?? "").trim().replace(/[\\/]/g, "／");
}

function pickRootName(snapshot) {
  const name = normalizePathSegment(snapshot?.card?.name);
  return name || "角色名";
}

function parseIndexSegment(segment) {
  const s = String(segment ?? "").trim();
  if (!s) return null;
  const bracket = s.match(/^\[(\d+)\]$/);
  if (bracket) return Number(bracket[1]);
  if (/^\d+$/.test(s)) return Number(s);
  return null;
}

export function parseFilePath(path, rootName) {
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
  if (parts.length > 1 && aliases.has(parts[0])) parts.shift();
  if (parts.length === 0) return { ok: false, error: "path 不完整。" };
  return { ok: true, parts };
}

function parsePath(path) {
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

function buildReadableSnapshot(draft, { includeVibePlan }) {
  const d = normalizeCardDraft(draft);
  const ext = d?.raw?.dataExtensions && typeof d.raw.dataExtensions === "object" ? d.raw.dataExtensions : {};
  const dataExtensions = includeVibePlan ? { ...ext } : (() => {
    const next = { ...ext };
    delete next.vibePlan;
    return next;
  })();

  return {
    card: d.card,
    worldbook: d.worldbook,
    regex_scripts: d.regex_scripts,
    tavern_helper: d.tavern_helper,
    raw: { dataExtensions },
  };
}

function normalizeOneRead(raw) {
  const obj = isPlainObject(raw) ? raw : {};
  const path = normalizeReadPath(obj.path);
  if (!path) return { ok: false, error: "read.path 不能为空。" };
  const offset = clampInt(obj.offset, { min: 0, max: Number.MAX_SAFE_INTEGER, fallback: 0 });
  const limit = clampInt(obj.limit, { min: 1, max: MAX_LIMIT, fallback: DEFAULT_LIMIT });
  return { ok: true, read: { path, offset, limit } };
}

export function isVcardReadDisplayMessageText(text) {
  const s = String(text || "").trimStart();
  return s.startsWith(VCARD_READ_PREFIX) || s.startsWith(VCARD_READ_RESULT_PREFIX);
}

export function buildReadRequestText(reads) {
  const payload = { kind: "read", reads: Array.isArray(reads) ? reads : [] };
  return [VCARD_READ_PREFIX, "```json", JSON.stringify(payload, null, 2), "```"].join("\n");
}

/**
 * 中文注释：
 * normalizeReadRequest(item)
 * 作用：归一化 kind=read 输出（限制数量/offset/limit）
 * 约束：只支持 reads[]；每项必须含 path；limit 上限 MAX_LIMIT
 * 参数：
 *  - item: object（模型输出对象）
 * 返回：{ ok:boolean, reads?:{path:string,offset:number,limit:number}[], error?:string }
 */
export function normalizeReadRequest(item) {
  const obj = isPlainObject(item) ? item : null;
  if (!obj || String(obj.kind || "") !== "read") return { ok: false, error: "不是 read 请求。" };
  const readsRaw = Array.isArray(obj.reads) ? obj.reads : [];
  if (readsRaw.length === 0) return { ok: false, error: "read.reads 不能为空。" };
  if (readsRaw.length > MAX_READS) return { ok: false, error: `read.reads 过多（${readsRaw.length} > ${MAX_READS}）。` };

  const reads = [];
  for (const r of readsRaw) {
    const normalized = normalizeOneRead(r);
    if (!normalized.ok) return { ok: false, error: normalized.error };
    reads.push(normalized.read);
  }
  return { ok: true, reads };
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
  if (parts.length === 0) return { ok: false, error: "path 不完整：worldbook" };
  const entries = Array.isArray(snapshot?.worldbook?.entries) ? snapshot.worldbook.entries : [];
  const picked = pickItemByNameOrIndex(entries, parts[0], (e) => e?.comment);
  if (!picked.ok) return picked;
  if (parts.length === 1) return { ok: true, value: toStringOrEmpty(picked.item?.content) };
  const sub = getByFileSegments(picked.item, parts.slice(1));
  if (!sub.ok) return sub;
  return { ok: true, value: sub.value };
}

function resolveRegexScriptFile(snapshot, parts) {
  if (parts.length === 0) return { ok: false, error: "path 不完整：regex_scripts" };
  const scripts = Array.isArray(snapshot?.regex_scripts) ? snapshot.regex_scripts : [];
  const picked = pickItemByNameOrIndex(scripts, parts[0], (s) => s?.name);
  if (!picked.ok) return picked;
  if (parts.length === 1) return { ok: true, value: picked.item };
  const sub = getByFileSegments(picked.item, parts.slice(1));
  if (!sub.ok) return sub;
  return { ok: true, value: sub.value };
}

function resolveTavernHelperFile(snapshot, parts) {
  if (parts.length < 2) return { ok: false, error: "path 不完整：tavern_helper" };
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
    const vars = snapshot?.tavern_helper?.variables && typeof snapshot.tavern_helper.variables === "object" ? snapshot.tavern_helper.variables : {};
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
  const [head, ...rest] = parsed.parts;

  if (CARD_FILE_KEYS.has(head)) return resolveCardFile(snapshot, [head, ...rest]);
  if (head === "alternate_greetings") return resolveAlternateGreetings(snapshot, rest);
  if (head === "worldbook") return resolveWorldbookFile(snapshot, rest);
  if (head === "regex_scripts") return resolveRegexScriptFile(snapshot, rest);
  if (head === "tavern_helper") return resolveTavernHelperFile(snapshot, rest);
  return { ok: false, error: `path 不存在：${head}` };
}

export function resolveFileContent({ draft, snapshot, path, includeVibePlan }) {
  const source = snapshot || buildReadableSnapshot(draft, { includeVibePlan });
  return resolveFileContentFromSnapshot(source, path);
}

function buildReadItemFromValue(value, read) {
  if (typeof value === "string") {
    const offset = clampInt(read.offset, { min: 0, max: value.length, fallback: 0 });
    const limit = clampInt(read.limit, { min: 1, max: MAX_LIMIT, fallback: DEFAULT_LIMIT });
    const sliced = value.slice(offset, offset + limit);
    const nextOffset = offset + limit;
    return {
      ok: true,
      item: {
        path: read.path,
        type: "string",
        offset,
        limit,
        totalLen: value.length,
        hasMore: nextOffset < value.length,
        nextOffset: nextOffset < value.length ? nextOffset : null,
        value: sliced,
      },
    };
  }

  const json = JSON.stringify(value);
  if (json.length > read.limit) {
    return { ok: false, item: { path: read.path, type: Array.isArray(value) ? "array" : typeof value, approxLen: json.length, error: "对象过大：请读取更具体的子路径。" } };
  }
  return { ok: true, item: { path: read.path, type: Array.isArray(value) ? "array" : typeof value, value } };
}

function readOneValue(snapshot, read) {
  const rawPath = String(read.path || "");
  if (rawPath.includes("/") || rawPath.includes("\\")) {
    const resolved = resolveFileContent({ snapshot, path: read.path, includeVibePlan: false });
    if (!resolved.ok) return { ok: false, item: { path: read.path, error: resolved.error } };
    return buildReadItemFromValue(resolved.value, read);
  }

  const segments = parsePath(read.path);
  if (!segments || segments.some((x) => !x)) return { ok: false, item: { path: read.path, error: "path 非法（仅支持 点分段 key 与单索引 [i]）。" } };
  const root = segments[0]?.key;
  if (!["card", "worldbook", "regex_scripts", "tavern_helper", "raw"].includes(String(root || ""))) {
    return { ok: false, item: { path: read.path, error: `不允许的根路径：${String(root || "")}` } };
  }

  const got = getBySegments(snapshot, segments);
  if (!got.ok) return { ok: false, item: { path: read.path, error: got.error } };
  return buildReadItemFromValue(got.value, read);
}

/**
 * 中文注释：
 * buildReadResultText({ draft, reads, includeVibePlan })
 * 作用：从草稿中读取指定 path 的片段，并生成【VCARD_READ_RESULT】消息文本
 * 约束：请求级（不持久化）；limit/reads 数量已在 normalizeReadRequest 侧限制
 * 参数：
 *  - draft: object（CardDraft）
 *  - reads: {path:string,offset:number,limit:number}[]
 *  - includeVibePlan: boolean（是否允许读取 vibePlan）
 * 返回：string
 */
export function buildReadResultText({ draft, reads, includeVibePlan }) {
  const snapshot = buildReadableSnapshot(draft, { includeVibePlan });
  const items = [];
  for (const r of Array.isArray(reads) ? reads : []) {
    const one = readOneValue(snapshot, r);
    items.push(one.item);
  }

  const payload = { kind: "read.result", items };
  return [VCARD_READ_RESULT_PREFIX, "```json", JSON.stringify(payload, null, 2), "```"].join("\n");
}

/**
 * 中文注释：
 * parseVcardReadDisplayMessage(text)
 * 作用：解析 VCARD_READ 或 VCARD_READ_RESULT 消息文本，用于 UI 渲染
 * 参数：
 *  - text: string（聊天消息内容）
 * 返回：{ ok:boolean, type?:'request'|'result', data?:object }
 */
export function parseVcardReadDisplayMessage(text) {
  const s = String(text || "").trim();
  if (!s) return { ok: false };

  const isRequest = s.startsWith(VCARD_READ_PREFIX);
  const isResult = s.startsWith(VCARD_READ_RESULT_PREFIX);
  if (!isRequest && !isResult) return { ok: false };

  const jsonMatch = s.match(/```json\s*([\s\S]*?)\s*```/);
  if (!jsonMatch) return { ok: false };

  try {
    const parsed = JSON.parse(jsonMatch[1]);
    if (isRequest && parsed.kind === "read" && Array.isArray(parsed.reads)) {
      return { ok: true, type: "request", data: parsed };
    }
    if (isResult && parsed.kind === "read.result" && Array.isArray(parsed.items)) {
      return { ok: true, type: "result", data: parsed };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

