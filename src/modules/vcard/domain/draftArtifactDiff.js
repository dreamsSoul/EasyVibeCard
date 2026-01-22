/**
 * 文件：draftArtifactDiff.js
 * 模块：vcard/domain
 * 作用：对 CardDraft 的“产物区”做稳定 diff（仅 card/worldbook/regex_scripts/tavern_helper），用于稳推进与 runLog 摘要
 * 依赖：无
 * @created 2025-12-31
 * @modified 2026-01-01
 */

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function joinPath(base, key) {
  if (!base) return String(key || "");
  return `${base}.${String(key || "")}`;
}

function joinIndex(base, index) {
  return `${base}[${Number(index)}]`;
}

function diffAny(path, before, after, changedPaths, limit) {
  if (changedPaths.length >= limit) return;
  if (Object.is(before, after)) return;

  const beforeIsArr = Array.isArray(before);
  const afterIsArr = Array.isArray(after);
  if (beforeIsArr || afterIsArr) {
    if (!beforeIsArr || !afterIsArr) return changedPaths.push(path);
    const max = Math.max(before.length, after.length);
    for (let i = 0; i < max; i += 1) {
      if (changedPaths.length >= limit) return;
      if (i >= before.length || i >= after.length) {
        changedPaths.push(joinIndex(path, i));
        continue;
      }
      diffAny(joinIndex(path, i), before[i], after[i], changedPaths, limit);
    }
    return;
  }

  const beforeIsObj = isPlainObject(before);
  const afterIsObj = isPlainObject(after);
  if (beforeIsObj || afterIsObj) {
    if (!beforeIsObj || !afterIsObj) return changedPaths.push(path);
    const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort();
    for (const k of keys) {
      if (changedPaths.length >= limit) return;
      diffAny(joinPath(path, k), before[k], after[k], changedPaths, limit);
    }
    return;
  }

  changedPaths.push(path);
}

/**
 * 中文注释：
 * draftArtifactDiff(before, after)
 * 作用：计算 CardDraft 的“产物差异”（不包含 raw/vibePlan 等元数据），并返回变化路径摘要
 * 约束：纯函数；changedPaths 仅包含路径，不包含 diff 值；默认最多返回 200 条路径
 * 参数：
 *  - before: object（CardDraft）
 *  - after: object（CardDraft）
 * 返回：{ artifactChanged:boolean, changedPaths:string[] }
 */
export function draftArtifactDiff(before, after) {
  const b = before && typeof before === "object" ? before : {};
  const a = after && typeof after === "object" ? after : {};
  const changedPaths = [];
  const limit = 200;

  diffAny("card", b.card ?? null, a.card ?? null, changedPaths, limit);
  diffAny("worldbook", b.worldbook ?? null, a.worldbook ?? null, changedPaths, limit);
  diffAny("regex_scripts", b.regex_scripts ?? null, a.regex_scripts ?? null, changedPaths, limit);
  diffAny("tavern_helper", b.tavern_helper ?? null, a.tavern_helper ?? null, changedPaths, limit);

  const uniq = Array.from(new Set(changedPaths));
  uniq.sort();
  return { artifactChanged: uniq.length > 0, changedPaths: uniq };
}
