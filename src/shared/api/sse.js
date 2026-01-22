/**
 * 文件：sse.js
 * 模块：shared/api
 * 作用：从 fetch 的 ReadableStream 解析 SSE 事件（浏览器端）
 * 依赖：TextDecoder
 * @created 2025-12-28
 * @modified 2025-12-28
 */

function splitSseEvents(buffer) {
  const parts = buffer.split(/\r\n\r\n|\n\n|\r\r/g);
  if (parts.length === 1) return { events: [], rest: buffer };
  return { events: parts.slice(0, -1), rest: parts[parts.length - 1] };
}

function parseSseEventChunk(chunk) {
  const lines = chunk.split(/\r\n|\n|\r/g);
  let event = "message";
  let data = "";
  let id = "";

  for (const line of lines) {
    if (!line) continue;
    const match = /([^:]+)(?:: ?(.*))?/.exec(line);
    if (!match) continue;
    const field = match[1];
    const value = match[2] || "";

    if (field === "id") id = value || "";
    if (field === "event") event = value || "message";
    if (field === "data") data += `${value}\n`;
  }

  if (!data) return null;
  if (data.endsWith("\n")) data = data.slice(0, -1);
  return { event, data, id: id || undefined };
}

// 中文注释：
// iterateSseEvents(readableStream)
// 作用：把 ReadableStream<Uint8Array> 解析为 {event,data} 序列
// 约束：只做 SSE 协议层拆帧，不理解 data 语义；兼容 \n\n 与 \r\n\r\n 分隔
// 参数：
//  - readableStream: ReadableStream<Uint8Array>
// 返回：AsyncGenerator<{event:string,data:string,id?:string}>
export async function* iterateSseEvents(readableStream) {
  if (!readableStream) return;
  const reader = readableStream.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = splitSseEvents(buffer);
      buffer = rest;

      for (const chunk of events) {
        const parsed = parseSseEventChunk(chunk);
        if (parsed) yield parsed;
      }
    }

    buffer += decoder.decode();
    const { events } = splitSseEvents(buffer);
    for (const chunk of events) {
      const parsed = parseSseEventChunk(chunk);
      if (parsed) yield parsed;
    }
  } finally {
    // 若上层提前 return（例如收到 final 即退出），这里主动 cancel 释放 reader 锁，
    // 避免浏览器把 SSE 请求长时间显示为 pending。
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}
