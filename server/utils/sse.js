/**
 * 文件：sse.js
 * 模块：server/utils
 * 作用：从 fetch ReadableStream 解析 SSE 事件（Node 端）
 * 依赖：TextDecoder
 * @created 2026-01-11
 * @modified 2026-01-11
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

  for (const line of lines) {
    if (!line) continue;
    const match = /([^:]+)(?:: ?(.*))?/.exec(line);
    if (!match) continue;
    const field = match[1];
    const value = match[2] || "";

    if (field === "event") event = value || "message";
    if (field === "data") data += `${value}\n`;
  }

  if (!data) return null;
  if (data.endsWith("\n")) data = data.slice(0, -1);
  return { event, data };
}

/**
 * 中文注释：
 * iterateSseEvents(readableStream)
 * 作用：把 ReadableStream<Uint8Array> 解析为 {event,data} 序列
 * 约束：只做 SSE 协议拆帧，不理解 data 语义；兼容 \n\n 与 \r\n\r\n 分隔
 * 参数：
 *  - readableStream: ReadableStream<Uint8Array>
 * 返回：AsyncGenerator<{event:string,data:string}>
 */
export async function* iterateSseEvents(readableStream) {
  if (!readableStream) return;
  const reader = readableStream.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

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
}

