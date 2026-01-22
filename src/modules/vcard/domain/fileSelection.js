/**
 * 文件：fileSelection.js
 * 模块：vcard/domain
 * 作用：把文件树路径解析为稳定的“选中目标”（用于文件级编辑器路由与选中态保持）
 * 依赖：fileSystemSummary（buildFileTree 的结构约定）
 * @created 2026-01-20
 * @modified 2026-01-20
 */

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

function normalizePathSegment(value) {
  return String(value ?? "").trim().replace(/[\\/]/g, "／");
}

function parseIndexSegment(segment) {
  const s = String(segment ?? "").trim();
  if (!s) return null;
  const bracket = s.match(/^\[(\d+)\]$/);
  if (bracket) return Number(bracket[1]);
  if (/^\d+$/.test(s)) return Number(s);
  return null;
}

function splitPath(rawPath) {
  const raw = String(rawPath ?? "").trim();
  if (!raw) return [];
  return raw.split("/").map((p) => String(p || "").trim()).filter(Boolean);
}

function findIndexByName(list, segment, getName) {
  const items = Array.isArray(list) ? list : [];
  const seg = normalizePathSegment(segment);
  const idx = items.findIndex((x) => normalizePathSegment(getName(x)) === seg);
  return idx >= 0 ? idx : null;
}

function pickRootName(draft) {
  return normalizePathSegment(draft?.card?.name) || "角色名";
}

/**
 * 中文注释：
 * pickVCardFileRef({ draft, path })
 * 作用：把文件树 path 解析为稳定的 fileRef（用于“点一个条目只编辑一个条目”）
 * 约束：fileRef 设计为尽量稳定（优先 index/key），避免重命名导致选中丢失
 * 参数：
 *  - draft: object（CardDraft）
 *  - path: string（文件树节点 path）
 * 返回：{ ok:boolean, ref?:object, error?:string }
 */
export function pickVCardFileRef({ draft, path }) {
  const d = draft && typeof draft === "object" ? draft : null;
  if (!d) return { ok: false, error: "草稿未就绪。" };

  const parts = splitPath(path);
  if (parts.length < 2) return { ok: false, error: "path 不完整。" };

  const rootName = pickRootName(d);
  const rootAliases = new Set([rootName, "角色名", "角色卡"]);
  const seg0 = normalizePathSegment(parts[0]);

  const slotIndex = rootAliases.has(seg0) ? 1 : 0;
  const slot = normalizePathSegment(parts[slotIndex]);
  const rest = parts.slice(slotIndex + 1);

  if (CARD_FILE_KEYS.has(slot) && rest.length === 0) {
    return { ok: true, ref: { kind: "card.field", key: slot } };
  }

  if (slot === "alternate_greetings" && rest.length === 1) {
    const idx = parseIndexSegment(rest[0]);
    if (idx === null) return { ok: false, error: "alternate_greetings 期望索引文件名（例如 0）。" };
    return { ok: true, ref: { kind: "card.alternate_greeting", index: idx } };
  }

  if (slot === "worldbook" && rest.length === 1) {
    const entries = Array.isArray(d?.worldbook?.entries) ? d.worldbook.entries : [];
    const idx = (() => {
      const byIndex = parseIndexSegment(rest[0]);
      if (byIndex !== null) return byIndex;
      return findIndexByName(entries, rest[0], (e) => e?.comment);
    })();
    if (idx === null) return { ok: false, error: "未找到对应 worldbook 条目。" };
    return { ok: true, ref: { kind: "worldbook.entry", index: idx } };
  }

  if (slot === "regex_scripts" && rest.length === 1) {
    const scripts = Array.isArray(d?.regex_scripts) ? d.regex_scripts : [];
    const idx = (() => {
      const byIndex = parseIndexSegment(rest[0]);
      if (byIndex !== null) return byIndex;
      return findIndexByName(scripts, rest[0], (s) => s?.name);
    })();
    if (idx === null) return { ok: false, error: "未找到对应 regex_scripts 条目。" };
    return { ok: true, ref: { kind: "regex_scripts.entry", index: idx } };
  }

  if (slot === "tavern_helper" && rest.length >= 2) {
    const area = normalizePathSegment(rest[0]);
    if (area === "scripts" && rest.length === 2) {
      const scripts = Array.isArray(d?.tavern_helper?.scripts) ? d.tavern_helper.scripts : [];
      const idx = (() => {
        const byIndex = parseIndexSegment(rest[1]);
        if (byIndex !== null) return byIndex;
        return findIndexByName(scripts, rest[1], (s) => s?.name || s?.id);
      })();
      if (idx === null) return { ok: false, error: "未找到对应 tavern_helper.scripts 条目。" };
      return { ok: true, ref: { kind: "tavern_helper.script", index: idx } };
    }

    if (area === "variables" && rest.length === 2) {
      const vars = d?.tavern_helper?.variables && typeof d.tavern_helper.variables === "object" ? d.tavern_helper.variables : {};
      const keyRaw = String(rest[1] || "");
      const key = (() => {
        if (keyRaw in vars) return keyRaw;
        const found = Object.keys(vars).find((k) => normalizePathSegment(k) === normalizePathSegment(keyRaw));
        return found || "";
      })();
      if (!key) return { ok: false, error: "未找到对应 tavern_helper.variables 条目。" };
      return { ok: true, ref: { kind: "tavern_helper.variable", key } };
    }
  }

  return { ok: true, ref: { kind: "raw", path: String(path || "") } };
}

function findChildFolder(node, name) {
  const children = Array.isArray(node?.children) ? node.children : [];
  return children.find((c) => c?.type === "folder" && String(c?.name || "") === String(name || "")) || null;
}

function pickChildFileAt(node, index) {
  const children = Array.isArray(node?.children) ? node.children : [];
  const i = Number(index);
  if (!Number.isFinite(i) || i < 0 || i >= children.length) return "";
  const child = children[i];
  if (!child || child.type !== "file") return "";
  return String(child.path || "");
}

/**
 * 中文注释：
 * resolvePathFromFileRef({ fileTree, fileRef })
 * 作用：根据 fileRef 反解出当前文件树下的 path（用于“重命名后仍保持选中”）
 * 约束：仅对 index/key 类型提供最佳努力；找不到则返回空字符串
 * 参数：
 *  - fileTree: object（buildFileTree 返回的根节点）
 *  - fileRef: object（pickVCardFileRef 返回的 ref）
 * 返回：string（path，找不到返回空串）
 */
export function resolvePathFromFileRef({ fileTree, fileRef }) {
  const root = fileTree && typeof fileTree === "object" ? fileTree : null;
  const ref = fileRef && typeof fileRef === "object" ? fileRef : null;
  if (!root || !ref) return "";

  const rootPath = String(root.path || root.name || "");
  const kind = String(ref.kind || "");
  if (!rootPath) return "";

  if (kind === "card.field") return `${rootPath}/${String(ref.key || "")}`;
  if (kind === "card.alternate_greeting") return `${rootPath}/alternate_greetings/${String(ref.index ?? "")}`;

  if (kind === "worldbook.entry") {
    const folder = findChildFolder(root, "worldbook");
    return pickChildFileAt(folder, ref.index);
  }

  if (kind === "regex_scripts.entry") {
    const folder = findChildFolder(root, "regex_scripts");
    return pickChildFileAt(folder, ref.index);
  }

  if (kind === "tavern_helper.script") {
    const th = findChildFolder(root, "tavern_helper");
    const scripts = findChildFolder(th, "scripts");
    return pickChildFileAt(scripts, ref.index);
  }

  if (kind === "tavern_helper.variable") {
    const th = findChildFolder(root, "tavern_helper");
    const varsFolder = findChildFolder(th, "variables");
    const children = Array.isArray(varsFolder?.children) ? varsFolder.children : [];
    const normalizedKey = normalizePathSegment(ref.key);
    const file = children.find((c) => c?.type === "file" && normalizePathSegment(c?.name) === normalizedKey);
    return String(file?.path || "");
  }

  if (kind === "raw") return String(ref.path || "");
  return "";
}
