/**
 * 文件：http.js
 * 模块：server/utils
 * 作用：HTTP 工具（连接中断 abort、SSE 透传、错误文本解析）
 * 依赖：无
 * @created 2026-01-01
 * @modified 2026-01-20
 */

export function attachAbortOnClose(req, controller) {
  const socket = req?.socket;
  if (!socket || typeof socket.on !== "function") return;
  if (typeof socket.removeAllListeners === "function") socket.removeAllListeners("close");
  socket.on("close", () => controller.abort());
}

export function createAbortController({ req, signal }) {
  const controller = new AbortController();
  attachAbortOnClose(req, controller);
  if (signal) {
    if (signal.aborted) controller.abort();
    else if (typeof signal.addEventListener === "function") signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller;
}

export async function readErrorText(res) {
  const text = await res.text().catch(() => "");
  if (!text) return `${res.status} ${res.statusText}`;
  try {
    const json = JSON.parse(text);
    return json?.error?.message || json?.message || text;
  } catch {
    return text;
  }
}

export async function pipeSseToExpress({ upstreamRes, res }) {
  res.status(upstreamRes.status);
  res.setHeader("Content-Type", upstreamRes.headers.get("content-type") || "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  if (!upstreamRes.body) return res.end();
  const reader = upstreamRes.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) res.write(Buffer.from(value));
  }
  res.end();
}
