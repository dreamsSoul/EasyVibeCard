/**
 * 文件：promptPack.js
 * 模块：server/entities/vcard
 * 作用：Prompt Pack（按 ctx 槽位注入）的归一化与合并（用于 VCard turn/run 的 ctx 注入）
 * 依赖：无
 * @created 2026-01-14
 * @modified 2026-01-14
 */

const ALLOWED_TARGETS = new Set([
  "worldInfoBefore",
  "worldInfoAfter",
  "dialogueExamples",
  "personaDescription",
  "charDescription",
  "charPersonality",
  "scenario",
]);

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizeStrategy(value) {
  const s = String(value || "");
  if (s === "prepend" || s === "append" || s === "replace") return s;
  return "prepend";
}

function mergeSlotText({ original, injected, strategy }) {
  const a = String(injected || "").trim();
  const b = String(original || "").trim();
  if (!a) return b;
  if (!b) return a;
  if (strategy === "replace") return a;
  if (strategy === "append") return `${b}\n\n${a}`.trim();
  return `${a}\n\n${b}`.trim();
}

/**
 * 中文注释：
 * normalizePromptPackLite(raw)
 * 作用：把任意输入归一化为 PromptPackLite（过滤未知 target/空 content）
 * 约束：仅支持 buildMessages() 已实现的 marker 槽位；默认 strategy=prepend
 * 参数：
 *  - raw: any（prompt pack 原始对象）
 * 返回：{ version:string, enabled:boolean, name:string, slots:{target:string,strategy:string,content:string}[] }
 */
export function normalizePromptPackLite(raw) {
  const obj = isPlainObject(raw) ? raw : {};
  const slots = Array.isArray(obj.slots) ? obj.slots : [];
  const normalizedSlots = slots
    .map((x) => {
      const s = isPlainObject(x) ? x : {};
      const target = String(s.target || "").trim();
      if (!ALLOWED_TARGETS.has(target)) return null;
      const content = String(s.content || "").trim();
      if (!content) return null;
      return { target, strategy: normalizeStrategy(s.strategy), content };
    })
    .filter(Boolean);

  return {
    version: String(obj.version || "v1"),
    enabled: obj.enabled === undefined ? true : Boolean(obj.enabled),
    name: String(obj.name || ""),
    slots: normalizedSlots,
  };
}

/**
 * 中文注释：
 * applyPromptPackToCtx(ctx, rawPack)
 * 作用：按 pack.slots 把文本合并到 ctx 指定槽位（返回新 ctx，不修改原对象）
 * 约束：仅对字符串槽位做合并；不做模板渲染；不写入未知字段
 * 参数：
 *  - ctx: object（原 ctx）
 *  - rawPack: any（Prompt Pack 原始对象）
 * 返回：{ ctx:object, appliedTargets:string[], packName:string, enabled:boolean }
 */
export function applyPromptPackToCtx(ctx, rawPack) {
  const base = isPlainObject(ctx) ? ctx : {};
  const pack = normalizePromptPackLite(rawPack);
  if (!pack.enabled || pack.slots.length === 0) {
    return { ctx: { ...base }, appliedTargets: [], packName: pack.name, enabled: Boolean(pack.enabled) };
  }

  const next = { ...base };
  const appliedTargets = [];
  for (const slot of pack.slots) {
    const original = String(next?.[slot.target] ?? "");
    const merged = mergeSlotText({ original, injected: slot.content, strategy: slot.strategy });
    next[slot.target] = merged;
    appliedTargets.push(slot.target);
  }
  return { ctx: next, appliedTargets, packName: pack.name, enabled: true };
}

