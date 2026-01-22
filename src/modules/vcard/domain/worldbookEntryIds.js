/**
 * 文件：worldbookEntryIds.js
 * 模块：vcard/domain
 * 作用：世界书条目 id 的生成与修复（递增、唯一、整数化）
 * 依赖：无
 * @created 2026-01-14
 * @modified 2026-01-14
 */

function toNonNegativeIntOrNull(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return i >= 0 ? i : null;
}

// 中文注释：
// computeNextWorldbookEntryId(entries)
// 作用：基于现有 entries 的最大数字 id，生成下一个递增 id
// 约束：仅考虑可解析为非负整数的 id；无可用 id 时从 0 开始
// 参数：
//  - entries: any[]（worldbook.entries）
// 返回：number
export function computeNextWorldbookEntryId(entries) {
  const list = Array.isArray(entries) ? entries : [];
  let maxId = -1;
  for (const e of list) {
    const id = toNonNegativeIntOrNull(e?.id);
    if (id === null) continue;
    maxId = Math.max(maxId, id);
  }
  return maxId + 1;
}

// 中文注释：
// ensureWorldbookEntryIds(entries)
// 作用：修复 entries[].id（空/重复/非数字）为递增且唯一的非负整数
// 约束：保持条目顺序不变；优先保留首个合法 id，其余按 max+1 递增分配
// 参数：
//  - entries: any[]（worldbook.entries）
// 返回：{ changed:boolean, entries:any[] }
export function ensureWorldbookEntryIds(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const used = new Set();
  let maxId = -1;

  for (const e of list) {
    const id = toNonNegativeIntOrNull(e?.id);
    if (id === null) continue;
    maxId = Math.max(maxId, id);
  }

  let changed = false;
  const out = list.map((raw) => {
    const e = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const originalId = e.id;
    let id = toNonNegativeIntOrNull(originalId);

    if (id === null || used.has(id)) {
      id = maxId + 1;
      while (used.has(id)) id += 1;
      maxId = Math.max(maxId, id);
      changed = true;
    } else if (originalId !== id) {
      changed = true;
    }

    used.add(id);
    if (originalId === id) return e;
    return { ...e, id };
  });

  return { changed, entries: out };
}

