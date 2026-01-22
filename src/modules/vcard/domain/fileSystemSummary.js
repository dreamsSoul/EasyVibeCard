/**
 * 文件：fileSystemSummary.js
 * 模块：vcard/domain
 * 作用：生成文件系统风格的草稿摘要与文件树
 * 依赖：cardDraft
 * @created 2026-01-05
 * @modified 2026-01-05
 */

import { normalizeCardDraft } from "./cardDraft";

const TEXT_HEAD_LEN = 160;
const FILE_PREVIEW_LIMIT = 10;
const META_PREVIEW_LIMIT = 8;
const VAR_KEY_PREVIEW_LIMIT = 24;

function toStringOrEmpty(value) {
  return String(value ?? "");
}

function toStringArray(value) {
  return (Array.isArray(value) ? value : [])
    .map((x) => String(x ?? "").trim())
    .filter((x) => x.length > 0);
}

function summarizeText(value) {
  const s = toStringOrEmpty(value);
  const len = s.length;
  const head = s.slice(0, TEXT_HEAD_LEN);
  return { len, head };
}

function normalizePathSegment(value) {
  return String(value ?? "").trim().replace(/[\\/]/g, "／");
}

function pickRootName(draft) {
  const name = normalizePathSegment(draft?.card?.name);
  return name || "角色名";
}

function buildPreviewList(list, limit = FILE_PREVIEW_LIMIT) {
  const items = Array.isArray(list) ? list : [];
  const preview = items.slice(0, limit);
  return { count: items.length, preview, more: Math.max(0, items.length - preview.length) };
}

function buildCardSummary(card) {
  const obj = card && typeof card === "object" ? card : {};
  return {
    name: toStringOrEmpty(obj.name),
    tags: toStringArray(obj.tags),
    alternate_greetings_count: toStringArray(obj.alternate_greetings).length,
    description: summarizeText(obj.description),
    personality: summarizeText(obj.personality),
    scenario: summarizeText(obj.scenario),
    first_mes: summarizeText(obj.first_mes),
    mes_example: summarizeText(obj.mes_example),
    creator_notes: summarizeText(obj.creator_notes),
    system_prompt: summarizeText(obj.system_prompt),
    post_history_instructions: summarizeText(obj.post_history_instructions),
  };
}

function buildWorldbookMetaSummary(worldbook) {
  const wb = worldbook && typeof worldbook === "object" ? worldbook : { name: "", entries: [] };
  const entries = Array.isArray(wb.entries) ? wb.entries : [];
  return {
    name: toStringOrEmpty(wb.name),
    entriesCount: entries.length,
    entries: entries.slice(0, META_PREVIEW_LIMIT).map((e, i) => ({
      i,
      enabled: Boolean(e?.enabled),
      light: toStringOrEmpty(e?.light),
      position: toStringOrEmpty(e?.position),
      order: e?.order ?? 0,
      use_regex: Boolean(e?.use_regex),
      comment: toStringOrEmpty(e?.comment),
      keysCount: toStringArray(e?.keys).length,
      secondaryKeysCount: toStringArray(e?.secondary_keys).length,
      secondary_logic: toStringOrEmpty(e?.secondary_logic),
    })),
    entriesMore: Math.max(0, entries.length - Math.min(entries.length, META_PREVIEW_LIMIT)),
  };
}

function buildRegexScriptsMetaSummary(list) {
  const scripts = Array.isArray(list) ? list : [];
  return {
    count: scripts.length,
    items: scripts.slice(0, META_PREVIEW_LIMIT).map((s, i) => ({
      i,
      name: toStringOrEmpty(s?.name),
      enabled: Boolean(s?.enabled),
      placement: Array.isArray(s?.placement) ? s.placement : [],
      find: {
        style: toStringOrEmpty(s?.find?.style),
        flags: toStringOrEmpty(s?.find?.flags),
        patternLen: toStringOrEmpty(s?.find?.pattern).length,
      },
      replaceLen: toStringOrEmpty(s?.replace).length,
    })),
    itemsMore: Math.max(0, scripts.length - Math.min(scripts.length, META_PREVIEW_LIMIT)),
  };
}

function buildTavernHelperMetaSummary(th) {
  const obj = th && typeof th === "object" ? th : { scripts: [], variables: {} };
  const scripts = Array.isArray(obj.scripts) ? obj.scripts : [];
  const variables = obj.variables && typeof obj.variables === "object" ? obj.variables : {};
  return {
    scriptsCount: scripts.length,
    scriptNames: buildPreviewList(scripts.map((s) => normalizePathSegment(s?.name) || normalizePathSegment(s?.id))),
    variablesCount: Object.keys(variables).length,
    variableKeysPreview: buildPreviewList(Object.keys(variables).sort(), VAR_KEY_PREVIEW_LIMIT),
  };
}

function buildRawMeta(raw, includeVibePlan) {
  const obj = raw && typeof raw === "object" ? raw : { dataExtensions: {} };
  const ext = obj.dataExtensions && typeof obj.dataExtensions === "object" ? obj.dataExtensions : {};
  const keys = Object.keys(ext).sort();
  return { dataExtensionsKeys: keys, vibePlanIncluded: Boolean(includeVibePlan && ext.vibePlan) };
}

function buildUniqueNames(list, getName) {
  const items = Array.isArray(list) ? list : [];
  const rawNames = items.map((item) => normalizePathSegment(getName(item)));
  const counts = {};
  for (const name of rawNames) {
    if (!name) continue;
    counts[name] = (counts[name] || 0) + 1;
  }
  return items.map((item, i) => {
    const name = rawNames[i];
    if (!name || counts[name] > 1) return `[${i}]`;
    return name;
  });
}

function buildFileTreeNames(draft) {
  const d = draft && typeof draft === "object" ? draft : {};
  const alt = toStringArray(d?.card?.alternate_greetings || []);
  const worldbookEntries = Array.isArray(d?.worldbook?.entries) ? d.worldbook.entries : [];
  const regexScripts = Array.isArray(d?.regex_scripts) ? d.regex_scripts : [];
  const tavernScripts = Array.isArray(d?.tavern_helper?.scripts) ? d.tavern_helper.scripts : [];
  const tavernVars = d?.tavern_helper?.variables && typeof d.tavern_helper.variables === "object" ? d.tavern_helper.variables : {};

  return {
    cardFiles: [
      "description",
      "personality",
      "scenario",
      "first_mes",
      "mes_example",
      "system_prompt",
      "creator_notes",
      "post_history_instructions",
    ],
    alternateGreetings: alt.map((_, i) => String(i)),
    worldbook: buildUniqueNames(worldbookEntries, (e) => e?.comment),
    regexScripts: buildUniqueNames(regexScripts, (s) => s?.name),
    tavernScripts: buildUniqueNames(tavernScripts, (s) => s?.name || s?.id),
    tavernVariables: Object.keys(tavernVars).map((k) => normalizePathSegment(k)),
  };
}

/**
 * 中文注释：
 * buildFileTree(draft)
 * 作用：把草稿转换为“文件系统树”结构（用于 UI 文件浏览器）
 * 约束：仅包含路径与名称，不包含正文
 * 参数：
 *  - draft: object（CardDraft）
 * 返回：{ type:'folder', name:string, path:string, children:object[] }
 */
export function buildFileTree(draft) {
  const d = normalizeCardDraft(draft);
  const rootName = pickRootName(d);
  const names = buildFileTreeNames(d);
  const rootPath = rootName;
  const toFile = (name, base) => ({ type: "file", name, path: `${base}/${name}` });
  const toFolder = (name, base, children) => ({ type: "folder", name, path: `${base}/${name}`, children });

  return {
    type: "folder",
    name: rootName,
    path: rootPath,
    children: [
      ...names.cardFiles.map((name) => toFile(name, rootPath)),
      toFolder("alternate_greetings", rootPath, names.alternateGreetings.map((name) => toFile(name, `${rootPath}/alternate_greetings`))),
      toFolder("worldbook", rootPath, names.worldbook.map((name) => toFile(name, `${rootPath}/worldbook`))),
      toFolder("regex_scripts", rootPath, names.regexScripts.map((name) => toFile(name, `${rootPath}/regex_scripts`))),
      toFolder("tavern_helper", rootPath, [
        toFolder("scripts", `${rootPath}/tavern_helper`, names.tavernScripts.map((name) => toFile(name, `${rootPath}/tavern_helper/scripts`))),
        toFolder("variables", `${rootPath}/tavern_helper`, names.tavernVariables.map((name) => toFile(name, `${rootPath}/tavern_helper/variables`))),
      ]),
    ],
  };
}

/**
 * 中文注释：
 * buildFileSystemSummary(draft, includeVibePlan)
 * 作用：生成文件系统风格的“核心摘要”（用于上下文注入）
 * 约束：不包含正文全文；世界书仅给 comment + 元信息
 * 参数：
 *  - draft: object（CardDraft）
 *  - includeVibePlan: boolean
 * 返回：object
 */
export function buildFileSystemSummary(draft, includeVibePlan) {
  const d = normalizeCardDraft(draft);
  const rootName = pickRootName(d);
  const names = buildFileTreeNames(d);
  return {
    root: rootName,
    card: buildCardSummary(d.card),
    fileTree: {
      card: names.cardFiles,
      alternate_greetings: buildPreviewList(names.alternateGreetings),
      worldbook: buildPreviewList(names.worldbook),
      regex_scripts: buildPreviewList(names.regexScripts),
      tavern_helper: {
        scripts: buildPreviewList(names.tavernScripts),
        variables: buildPreviewList(names.tavernVariables, VAR_KEY_PREVIEW_LIMIT),
      },
    },
    worldbookMeta: buildWorldbookMetaSummary(d.worldbook),
    regexMeta: buildRegexScriptsMetaSummary(d.regex_scripts),
    tavernHelperMeta: buildTavernHelperMetaSummary(d.tavern_helper),
    rawMeta: buildRawMeta(d.raw, includeVibePlan),
    readHint: {
      note: "只给目录与元信息；正文请用 kind=read 读取文件路径。",
      examples: [
        `${rootName}/description`,
        `${rootName}/worldbook/角色背景`,
        `${rootName}/regex_scripts/表情替换`,
        `${rootName}/tavern_helper/scripts/脚本名`,
      ],
    },
  };
}
