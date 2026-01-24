/**
 * 文件：charaCardV3.js
 * 模块：vcard/domain
 * 作用：CardDraft ⇄ chara_card_v3 的导入/导出映射（含无损保留 extensions）
 * 依赖：cardDraft、worldbookPositions、regexUtils
 * @created 2025-12-29
 * @modified 2026-01-01
 */

import { normalizeCardDraft, normalizeRegexScriptLite, normalizeTavernHelperPackLite, normalizeWorldbookEntryLite } from "./cardDraft";
import { fromStWorldbookPosition, isAtDepthPositionKey, isWorldbookPositionKey, toStWorldbookPosition } from "./worldbookPositions";
import { resolveFindRegex } from "./regexUtils";

const SECONDARY_LOGIC_TO_ST = Object.freeze({
  and_any: 0,
  not_all: 1,
  not_any: 2,
  and_all: 3,
});

const ST_TO_SECONDARY_LOGIC = Object.freeze({
  0: "and_any",
  1: "not_all",
  2: "not_any",
  3: "and_all",
});

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function toStringArray(value) {
  return (Array.isArray(value) ? value : [])
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

function toFiniteNumberOrNullPreserveNull(value) {
  if (value === null || value === undefined || value === "") return null;
  return toFiniteNumberOrNull(value);
}

function genId(prefix) {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${prefix || "id"}_${Date.now()}_${Math.trunc(Math.random() * 100000)}`;
}

function ensureWorldNameInExtensions(ext, fallbackName) {
  const obj = isPlainObject(ext) ? ext : {};
  const fallback = String(fallbackName || "").trim();
  const world = obj.world;

  if (typeof world === "string") {
    const name = world.trim() || fallback;
    obj.world = name;
    return name;
  }
  if (isPlainObject(world)) {
    const name = String(world.name || "").trim() || fallback;
    obj.world = { ...world, name };
    return name;
  }

  // 缺失/非法类型：强制补齐为字符串（允许为空字符串，保证 key 存在）。
  obj.world = fallback;
  return fallback;
}

function normalizeBoolLike(value, fallback) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return Boolean(fallback);
}

function ensureDefaultExtensionsForExport(ext) {
  const obj = isPlainObject(ext) ? ext : {};
  if (obj.fav === undefined) obj.fav = false;
  obj.fav = normalizeBoolLike(obj.fav, false);

  const talk = String(obj.talkativeness ?? "").trim();
  obj.talkativeness = talk || "0.5";

  const dp = isPlainObject(obj.depth_prompt) ? obj.depth_prompt : {};
  const depth = Number.isFinite(Number(dp.depth)) ? Math.trunc(Number(dp.depth)) : 4;
  obj.depth_prompt = {
    ...dp,
    prompt: String(dp.prompt ?? ""),
    depth,
    role: String(dp.role || "system"),
  };

  return obj;
}

function buildFindRegexString(find) {
  const resolved = resolveFindRegex(find);
  // 避免“双重转义”：用户可能把 slash 风格（/..../g）里的 `\/` 直接作为 raw pattern 存进来；
  // 导出时我们会把 `/` 转义为 `\/`，因此需要先把已存在的 `\/` 归一化为 `/`。
  const normalized = String(resolved.pattern || "").replaceAll("\\/", "/");
  const body = normalized.replaceAll("/", "\\/");
  const flags = String(resolved.flags || "");
  return `/${body}/${flags}`;
}

function importTavernHelper(value) {
  if (Array.isArray(value)) {
    const obj = {};
    for (const it of value) {
      if (!Array.isArray(it) || it.length < 2) continue;
      const k = String(it[0] || "");
      obj[k] = it[1];
    }
    return normalizeTavernHelperPackLite({ scripts: obj.scripts, variables: obj.variables });
  }
  return normalizeTavernHelperPackLite(value);
}

function exportTavernHelperTuple(pack) {
  const p = normalizeTavernHelperPackLite(pack);
  const scripts = p.scripts.map((s) => ({ ...s, id: String(s.id || genId("th")) }));
  return [
    ["scripts", scripts],
    ["variables", p.variables],
  ];
}

function exportRegexScriptsToSt(list) {
  const scripts = (Array.isArray(list) ? list : []).map(normalizeRegexScriptLite);
  return scripts
    .filter((s) => String(s.name || s.id || "").trim())
    .map((s) => {
      const enabled = Boolean(s.enabled);
      const substituteRegex = toFiniteNumberOrNullPreserveNull(s.options?.substituteRegex) ?? 0;
      const minDepth = toFiniteNumberOrNullPreserveNull(s.options?.minDepth);
      const maxDepth = toFiniteNumberOrNullPreserveNull(s.options?.maxDepth);
      return {
        id: String(s.id || genId("rs")),
        scriptName: String(s.name || ""),
        findRegex: buildFindRegexString(s.find),
        replaceString: String(s.replace || ""),
        trimStrings: Array.isArray(s.trimStrings) ? s.trimStrings : [],
        placement: Array.isArray(s.placement) ? s.placement : [],
        disabled: !enabled,
        markdownOnly: Boolean(s.markdownOnly),
        promptOnly: Boolean(s.promptOnly),
        runOnEdit: Boolean(s.options?.runOnEdit),
        substituteRegex,
        minDepth,
        maxDepth,
      };
    });
}

function importRegexScriptsFromSt(list) {
  const scripts = Array.isArray(list) ? list : [];
  return scripts
    .filter((s) => s && typeof s === "object")
    .map((s) => {
      const substituteRegex = toFiniteNumberOrNullPreserveNull(s.substituteRegex) ?? 0;
      const minDepth = toFiniteNumberOrNullPreserveNull(s.minDepth);
      const maxDepth = toFiniteNumberOrNullPreserveNull(s.maxDepth);
      return normalizeRegexScriptLite({
        id: String(s.id || ""),
        name: String(s.scriptName || ""),
        enabled: !Boolean(s.disabled),
        placement: Array.isArray(s.placement) ? s.placement : [],
        trimStrings: Array.isArray(s.trimStrings) ? s.trimStrings : [],
        markdownOnly: Boolean(s.markdownOnly),
        promptOnly: Boolean(s.promptOnly),
        find: { style: "slash", pattern: String(s.findRegex || ""), flags: "" },
        replace: String(s.replaceString || ""),
        options: {
          runOnEdit: Boolean(s.runOnEdit),
          substituteRegex,
          minDepth,
          maxDepth,
        },
      });
    });
}

function exportWorldbookEntries(list) {
  const entries = (Array.isArray(list) ? list : []).map(normalizeWorldbookEntryLite);
  return entries.map((e, i) => {
    const st = toStWorldbookPosition(e.position);
    const secondaryLogic = SECONDARY_LOGIC_TO_ST[String(e.secondary_logic || "and_any")] ?? 0;
    const isAtDepth = isAtDepthPositionKey(e.position);
    const depth = isAtDepth ? Number(e.at_depth?.depth ?? 0) : 4;

    const extensions = { ...(isPlainObject(e.raw_extensions) ? e.raw_extensions : {}) };
    extensions.position = st.position;
    extensions.selectiveLogic = secondaryLogic;
    extensions.depth = depth;
    if (st.role !== undefined) extensions.role = st.role;

    return {
      id: Number.isFinite(Number(e.id)) ? Number(e.id) : i,
      keys: toStringArray(e.keys),
      secondary_keys: toStringArray(e.secondary_keys),
      comment: String(e.comment || ""),
      content: String(e.content || ""),
      constant: String(e.light || "blue") === "blue",
      selective: String(e.light || "blue") === "green",
      insertion_order: Number.isFinite(Number(e.order)) ? Number(e.order) : 100,
      enabled: Boolean(e.enabled),
      position: isAtDepth ? "at_depth" : String(e.position || "after_char"),
      use_regex: Boolean(e.use_regex),
      extensions,
    };
  });
}

function importWorldbookEntries(list) {
  const entries = Array.isArray(list) ? list : [];
  return entries
    .filter((e) => e && typeof e === "object")
    .map((e) => {
      const ext = isPlainObject(e.extensions) ? e.extensions : {};
      const posNum = toFiniteNumberOrNull(ext.position);
      const roleNum = toFiniteNumberOrNull(ext.role);
      const depth = toFiniteNumberOrNull(ext.depth);
      const position = (() => {
        if (posNum !== null) return fromStWorldbookPosition(posNum, roleNum);
        const posStr = String(e.position || "");
        if (posStr === "at_depth") return fromStWorldbookPosition(4, roleNum);
        if (isWorldbookPositionKey(posStr)) return posStr;
        return "after_char";
      })();

      const light = toBool(e.constant, false) ? "blue" : toBool(e.selective, false) ? "green" : "blue";
      const secondaryLogic = ST_TO_SECONDARY_LOGIC[String(ext.selectiveLogic)] || "and_any";

      const out = normalizeWorldbookEntryLite({
        id: e.id,
        enabled: toBool(e.enabled, true),
        light,
        keys: toStringArray(e.keys),
        secondary_keys: toStringArray(e.secondary_keys),
        secondary_logic: secondaryLogic,
        comment: String(e.comment || ""),
        content: String(e.content || ""),
        position,
        at_depth: isAtDepthPositionKey(position) ? { depth: depth ?? 0 } : null,
        order: toFiniteNumberOrNull(e.insertion_order) ?? 100,
        use_regex: toBool(e.use_regex, true),
        raw_extensions: ext,
      });
      return out;
    });
}

/**
 * 中文注释：
 * cardDraftToCharaCardV3(draft)
 * 作用：把内部 CardDraft 导出为 chara_card_v3（用于 JSON/PNG）
 * 约束：导出时做字段顺序稳定；未知 extensions 从 raw.dataExtensions 回填
 * 参数：
 *  - draft: object（CardDraft）
 *  - opts?: { mode?: 'work'|'publish' }（publish 会过滤 extensions.vibePlan）
 * 返回：object（chara_card_v3 JSON）
 */
export function cardDraftToCharaCardV3(draft, opts = {}) {
  const d = normalizeCardDraft(draft);
  const mode = String(opts?.mode || "work") === "publish" ? "publish" : "work";

  const extensions = { ...(isPlainObject(d.raw?.dataExtensions) ? d.raw.dataExtensions : {}) };
  if (mode === "publish") delete extensions.vibePlan;

  // 约束：导出时必须包含 data.extensions.world；若 world 为空/缺失，用 card.name 兜底。
  // 同时：导出的 data.name 优先与 world 保持一致，避免外部生态读取不到“世界名”。
  const cardName = String(d.card.name || "").trim();
  const name = ensureWorldNameInExtensions(extensions, cardName);
  ensureDefaultExtensionsForExport(extensions);
  const regexScripts = exportRegexScriptsToSt(d.regex_scripts);
  if (regexScripts.length > 0) extensions.regex_scripts = regexScripts;
  if (d.tavern_helper?.scripts?.length || Object.keys(d.tavern_helper?.variables || {}).length) extensions.tavern_helper = exportTavernHelperTuple(d.tavern_helper);

  const data = {
    name,
    description: String(d.card.description || ""),
    personality: String(d.card.personality || ""),
    scenario: String(d.card.scenario || ""),
    first_mes: String(d.card.first_mes || ""),
    mes_example: String(d.card.mes_example || ""),
    creator_notes: String(d.card.creator_notes || ""),
    system_prompt: String(d.card.system_prompt || ""),
    post_history_instructions: String(d.card.post_history_instructions || ""),
    alternate_greetings: Array.isArray(d.card.alternate_greetings) ? d.card.alternate_greetings : [],
    tags: Array.isArray(d.card.tags) ? d.card.tags : [],
    creator: "",
    character_version: "",
    group_only_greetings: [],
  };

  const wbHasAny = Array.isArray(d.worldbook?.entries) && d.worldbook.entries.length > 0;
  const wbName = String(d.worldbook?.name || "").trim() || `${name || "unknown"}_worldbook`;
  if (wbHasAny || String(d.worldbook?.name || "").trim()) {
    data.character_book = { name: wbName, entries: exportWorldbookEntries(d.worldbook.entries), extensions: {} };
  }
  if (Object.keys(extensions).length > 0) data.extensions = extensions;

  const createDate = new Date().toISOString();
  return {
    name: data.name,
    spec: "chara_card_v3",
    spec_version: "3.0",
    data,
    fav: Boolean(extensions.fav),
    description: data.description,
    personality: data.personality,
    scenario: data.scenario,
    first_mes: data.first_mes,
    mes_example: data.mes_example,
    tags: data.tags,
    create_date: createDate,
    creatorcomment: "",
    avatar: "none",
    talkativeness: String(extensions.talkativeness || "0.5"),
  };
}

/**
 * 中文注释：
 * charaCardToCardDraft(card)
 * 作用：把 chara_card_v2/v3 导入为 CardDraft（并把未知 extensions 进行无损保留）
 * 约束：仅解析本项目关注字段；其余保留到 raw.dataExtensions
 * 参数：
 *  - card: any（角色卡 JSON）
 * 返回：object（CardDraft）
 */
export function charaCardToCardDraft(card) {
  const root = isPlainObject(card) ? card : {};
  const data = isPlainObject(root.data) ? root.data : root;
  const extensions = isPlainObject(data.extensions) ? data.extensions : {};

  const knownExt = new Set(["regex_scripts", "tavern_helper"]);
  const rawExt = {};
  for (const [k, v] of Object.entries(extensions)) if (!knownExt.has(k)) rawExt[k] = v;

  const out = normalizeCardDraft({
    meta: { spec: String(root.spec || "chara_card_v3"), spec_version: String(root.spec_version || "3.0") },
    card: {
      name: String(data.name || ""),
      description: String(data.description || ""),
      personality: String(data.personality || ""),
      scenario: String(data.scenario || ""),
      first_mes: String(data.first_mes || ""),
      mes_example: String(data.mes_example || ""),
      creator_notes: String(data.creator_notes || ""),
      system_prompt: String(data.system_prompt || ""),
      post_history_instructions: String(data.post_history_instructions || ""),
      alternate_greetings: Array.isArray(data.alternate_greetings) ? data.alternate_greetings : [],
      tags: Array.isArray(data.tags) ? data.tags : [],
    },
    worldbook: {
      name: String(data.character_book?.name || ""),
      entries: importWorldbookEntries(data.character_book?.entries),
    },
    regex_scripts: importRegexScriptsFromSt(extensions.regex_scripts),
    tavern_helper: importTavernHelper(extensions.tavern_helper),
    raw: { dataExtensions: rawExt },
  });

  return out;
}
