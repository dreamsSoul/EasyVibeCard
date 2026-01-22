/**
 * 文件：storage.js
 * 模块：shared/storage
 * 作用：localStorage JSON 读写
 * 依赖：无
 * @created 2025-12-28
 * @modified 2025-12-28
 */

export function readStorageJson(key, fallback) {
  try {
    const raw = localStorage.getItem(String(key));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeStorageJson(key, value) {
  try {
    localStorage.setItem(String(key), JSON.stringify(value));
  } catch {
    // ignore
  }
}

