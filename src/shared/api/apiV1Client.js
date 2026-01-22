/**
 * 文件：apiV1Client.js
 * 模块：shared/api
 * 作用：/api/v1 通用 JSON 请求封装（统一错误信息）
 * 依赖：fetch
 * @created 2026-01-11
 * @modified 2026-01-11
 */

function safeJsonParse(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
}

function toErrorMessage({ res, json }) {
  const msg = String(json?.message || json?.error || "").trim();
  const code = String(json?.code || "").trim();
  const base = msg || `${res.status} ${res.statusText}`;
  return code ? `${code}: ${base}` : base;
}

/**
 * 中文注释：
 * apiV1FetchJson(path, options)
 * 作用：调用后端 /api/v1 并返回 JSON（自动抛错）
 * 约束：错误按 {ok:false,code,message,details} 优先；非 JSON 时回退到 statusText
 * 参数：
 *  - path: string
 *  - options?: { method?:string, body?:any }
 * 返回：Promise<any>
 */
export async function apiV1FetchJson(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const hasBody = Object.prototype.hasOwnProperty.call(options || {}, "body");
  const res = await fetch(String(path || ""), {
    method,
    headers: hasBody ? { "Content-Type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(options.body ?? null) : undefined,
    signal: options?.signal,
  });

  const text = await res.text().catch(() => "");
  const json = safeJsonParse(text);
  if (!res.ok || json?.ok === false) {
    const err = new Error(toErrorMessage({ res, json }));
    err.status = res.status;
    err.code = json?.code;
    err.details = json?.details;
    throw err;
  }
  return json;
}
