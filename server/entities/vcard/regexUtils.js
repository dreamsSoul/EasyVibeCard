/**
 * 文件：regexUtils.js
 * 模块：server/entities/vcard
 * 作用：Regex Scripts 的正则解析/flags 归一化/编译校验（兼容 slash/raw）
 * 依赖：无
 * @created 2026-01-11
 * @modified 2026-01-11
 */

const ALLOWED_FLAGS = new Set(["g", "i", "m", "s", "u", "y"]);

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function sanitizeFlags(flags) {
  const raw = String(flags || "");
  const out = [];
  for (const ch of raw) {
    if (!ALLOWED_FLAGS.has(ch)) continue;
    if (out.includes(ch)) continue;
    out.push(ch);
  }
  return out.join("");
}

function findLastUnescapedSlash(text) {
  const s = String(text || "");
  for (let i = s.length - 1; i >= 1; i--) {
    if (s[i] !== "/") continue;
    let bs = 0;
    for (let j = i - 1; j >= 0 && s[j] === "\\"; j--) bs++;
    if (bs % 2 === 1) continue;
    return i;
  }
  return -1;
}

/**
 * 中文注释：
 * resolveFindRegex(find)
 * 作用：把 find（Lite）归一化为可编译的 pattern/flags，并回传 warnings
 * 约束：style=slash 时支持 /.../gimsuy；flags 中非法字符会被剔除
 * 参数：
 *  - find: any（{pattern,flags,style}）
 * 返回：{ pattern:string, flags:string, warnings:string[] }
 */
export function resolveFindRegex(find) {
  const f = isPlainObject(find) ? find : {};
  const style = String(f.style || "raw");
  const warnings = [];

  if (style !== "slash") {
    const flags = sanitizeFlags(f.flags);
    if (String(f.flags || "") !== flags) warnings.push("flags 含非法字符，已自动剔除。");
    return { pattern: String(f.pattern || ""), flags, warnings };
  }

  const src = String(f.pattern || "");
  if (!src.startsWith("/")) {
    warnings.push("style=slash 但 pattern 不以 / 开头，将按 raw 处理。");
    const flags = sanitizeFlags(f.flags);
    if (String(f.flags || "") !== flags) warnings.push("flags 含非法字符，已自动剔除。");
    return { pattern: src, flags, warnings };
  }

  const last = findLastUnescapedSlash(src);
  if (last <= 0) return { pattern: src.slice(1), flags: sanitizeFlags(f.flags), warnings: [...warnings, "slash 风格解析失败，已降级为 raw。"] };

  const body = src.slice(1, last);
  const flagsRaw = src.slice(last + 1);
  const flags = sanitizeFlags(flagsRaw);
  if (flagsRaw !== flags) warnings.push("slash 风格 flags 含非法字符，已自动剔除。");
  return { pattern: body, flags, warnings };
}

/**
 * 中文注释：
 * tryCompileRegex(pattern, flags)
 * 作用：尝试编译 RegExp，用于校验 findRegex 可用性
 * 约束：仅做 new RegExp 的语法校验，不执行替换
 * 参数：
 *  - pattern: string
 *  - flags: string
 * 返回：{ ok:boolean, error?:string }
 */
export function tryCompileRegex(pattern, flags) {
  try {
    // eslint-disable-next-line no-new
    new RegExp(String(pattern || ""), String(flags || ""));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}
