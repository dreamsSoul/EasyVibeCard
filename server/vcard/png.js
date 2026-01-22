/**
 * 文件：png.js
 * 模块：vcard/png
 * 作用：PNG 角色卡：提取/写入 tEXt:ccv3/chara（base64 JSON）
 * 依赖：png-chunks-extract、png-chunks-encode、png-chunk-text
 * @created 2025-12-29
 * @modified 2025-12-29
 */

import extract from "png-chunks-extract";
import encode from "png-chunks-encode";
import PNGtext from "png-chunk-text";

function isTextChunk(chunk) {
  return chunk && chunk.name === "tEXt" && chunk.data;
}

function decodeTextChunk(chunk) {
  try {
    return PNGtext.decode(chunk.data);
  } catch {
    return null;
  }
}

function pickPreferredTextChunk(textChunks) {
  const list = Array.isArray(textChunks) ? textChunks : [];
  const byKey = (k) => list.find((x) => String(x.keyword || "").trim().toLowerCase() === k);
  return byKey("ccv3") || byKey("chara") || null;
}

/**
 * 中文注释：
 * extractCardJsonFromPngBuffer(pngBuffer)
 * 作用：从 PNG tEXt chunk 提取并解析角色卡 JSON（优先 ccv3）
 * 约束：仅支持 SillyTavern 常见的 tEXt:ccv3/chara base64 JSON；找不到则抛错
 * 参数：
 *  - pngBuffer: Buffer（PNG 二进制）
 * 返回：object（角色卡 JSON）
 */
export function extractCardJsonFromPngBuffer(pngBuffer) {
  const chunks = extract(new Uint8Array(pngBuffer));
  const decoded = chunks
    .filter(isTextChunk)
    .map((c) => decodeTextChunk(c))
    .filter((x) => x && typeof x.keyword === "string" && typeof x.text === "string");

  const preferred = pickPreferredTextChunk(decoded);
  if (!preferred) throw new Error("未找到角色卡元数据（tEXt: ccv3/chara）。");

  const jsonString = Buffer.from(preferred.text, "base64").toString("utf-8");
  return JSON.parse(jsonString);
}

function isMetaKeyword(textChunk, keyword) {
  return String(textChunk?.keyword || "").trim().toLowerCase() === String(keyword || "").trim().toLowerCase();
}

/**
 * 中文注释：
 * embedCardJsonToPngBuffer(pngBuffer, cardJson)
 * 作用：把角色卡 JSON 写入 PNG 的 tEXt:ccv3 与 tEXt:chara（base64）
 * 约束：会移除旧的 ccv3/chara tEXt chunk；写入位置在 IEND 之前
 * 参数：
 *  - pngBuffer: Buffer（原 PNG）
 *  - cardJson: object（角色卡 JSON）
 * 返回：Buffer（新 PNG）
 */
export function embedCardJsonToPngBuffer(pngBuffer, cardJson) {
  const base64 = Buffer.from(JSON.stringify(cardJson)).toString("base64");
  const chunks = extract(new Uint8Array(pngBuffer));

  const out = [];
  for (const chunk of chunks) {
    if (!isTextChunk(chunk)) {
      out.push(chunk);
      continue;
    }
    const decoded = decodeTextChunk(chunk);
    if (!decoded) {
      out.push(chunk);
      continue;
    }
    if (isMetaKeyword(decoded, "ccv3") || isMetaKeyword(decoded, "chara")) continue;
    out.push(chunk);
  }

  const iendIndex = out.findIndex((c) => c?.name === "IEND");
  const insertAt = iendIndex < 0 ? out.length : iendIndex;
  out.splice(insertAt, 0, PNGtext.encode("chara", base64), PNGtext.encode("ccv3", base64));

  const encoded = encode(out);
  return Buffer.from(encoded);
}

