/**
 * 文件：outputCleaner.js
 * 模块：server/entities/vcard
 * 作用：VCard 上下文输出清洗（去 think/analysis 等），用于构建 messages 时清洗 assistant 历史
 * 依赖：regexUtils
 * @created 2026-01-14
 * @modified 2026-01-14
 */

import { resolveFindRegex } from "./regexUtils.js";

const DEFAULT_CONFIG = Object.freeze({
  version: "v1",
  enabled: true,
  rules: [
    { name: "strip_think_tag", enabled: true, style: "raw", pattern: "<think>[\\s\\S]*?<\\/think>", flags: "gi", replace: "" },
    { name: "strip_analysis_tag", enabled: true, style: "raw", pattern: "<analysis>[\\s\\S]*?<\\/analysis>", flags: "gi", replace: "" },
    { name: "strip_thought_lines", enabled: false, style: "raw", pattern: "^\\s*(Thought|思考|推理)\\s*[:：].*$", flags: "gmi", replace: "" },
  ],
});

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizeFlags(value) {
  const raw = String(value || "");
  const allowed = new Set(["g", "i", "m", "s", "u", "y"]);
  const out = [];
  for (const ch of raw) {
    if (!allowed.has(ch)) continue;
    if (out.includes(ch)) continue;
    out.push(ch);
  }
  return out.join("");
}

function normalizeStyle(value, pattern) {
  const s = String(value || "");
  if (s === "raw" || s === "slash") return s;
  const p = String(pattern || "");
  return p.trim().startsWith("/") ? "slash" : "raw";
}

function normalizeRule(raw) {
  const obj = isPlainObject(raw) ? raw : {};
  const name = String(obj.name || "").trim();
  const pattern = String(obj.pattern || "");
  if (!pattern) return null;

  const style = normalizeStyle(obj.style, pattern);
  const normalizeEnforcedFlags = (flagsRaw) => {
    const base = normalizeFlags(flagsRaw);
    if (style !== "raw") return base;
    if (name !== "strip_think_tag" && name !== "strip_analysis_tag") return base;
    const ensure = (s, ch) => (s.includes(ch) ? s : `${s}${ch}`);
    return ensure(ensure(base, "g"), "i");
  };

  return {
    name,
    enabled: obj.enabled === undefined ? true : Boolean(obj.enabled),
    style,
    pattern,
    flags: normalizeEnforcedFlags(obj.flags),
    replace: String(obj.replace ?? ""),
  };
}

/**
 * 中文注释：
 * normalizeOutputCleanerConfig(raw)
 * 作用：把任意输入归一化为 OutputCleanerConfig（过滤非法 rule）
 * 约束：默认 enabled=true；flags 仅允许 gimsuy 子集
 * 参数：
 *  - raw: any
 * 返回：{ version:string, enabled:boolean, rules:{name:string,enabled:boolean,pattern:string,flags:string,replace:string,style?:string}[] }
 */
export function normalizeOutputCleanerConfig(raw) {
  const obj = isPlainObject(raw) ? raw : {};
  const rules = (Array.isArray(obj.rules) ? obj.rules : []).map(normalizeRule).filter(Boolean);
  return {
    version: String(obj.version || DEFAULT_CONFIG.version),
    enabled: obj.enabled === undefined ? DEFAULT_CONFIG.enabled : Boolean(obj.enabled),
    rules,
  };
}

/**
 * 中文注释：
 * applyOutputCleaner(text, rawConfig)
 * 作用：按规则顺序清洗文本（用于上下文），并返回是否发生变化
 * 约束：单条规则 RegExp 构建失败则跳过（不抛异常）
 * 参数：
 *  - text: string
 *  - rawConfig: any（OutputCleanerConfig）
 * 返回：{ text:string, changed:boolean }
 */
export function applyOutputCleaner(text, rawConfig) {
  const input = String(text || "");
  const cfg = normalizeOutputCleanerConfig(rawConfig ?? DEFAULT_CONFIG);
  if (!cfg.enabled || cfg.rules.length === 0) return { text: input, changed: false };

  let out = input;
  for (const r of cfg.rules) {
    if (!r.enabled) continue;
    try {
      const resolved = resolveFindRegex({ style: r.style, pattern: r.pattern, flags: r.flags });
      const re = new RegExp(resolved.pattern, resolved.flags);
      out = out.replace(re, r.replace);
    } catch {
      // ignore invalid regex
    }
  }
  const normalized = out.trim();
  return { text: normalized, changed: normalized !== input.trim() };
}

export function defaultOutputCleanerConfig() {
  return DEFAULT_CONFIG;
}

