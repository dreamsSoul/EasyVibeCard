/**
 * 文件：time.js
 * 模块：shared/utils
 * 作用：时间格式化
 * 依赖：无
 * @created 2025-12-28
 * @modified 2025-12-28
 */

export function nowTime() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

