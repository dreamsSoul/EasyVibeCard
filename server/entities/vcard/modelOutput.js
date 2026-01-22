/**
 * 文件：modelOutput.js
 * 模块：server/entities/vcard
 * 作用：解析模型输出（tool_use），并做 kind 白名单校验
 * 依赖：无
 * @created 2026-01-07
 * @modified 2026-01-16
 */

const ALLOWED_KINDS = Object.freeze([
  "card.patch",
  "worldbook.patch",
  "worldbook.target",
  "regex_scripts.patch",
  "tavern_helper.patch",
  "regex_scripts.set",
  "client_scripts.set",
]);

function safeJsonParse(text) {
  try {
    return { ok: true, value: JSON.parse(String(text || "")) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function extractFirstJsonCodeBlock(text) {
  const s = String(text || "");
  const m = s.match(/(`{3,})json\s*([\s\S]*?)\s*\1/i);
  if (!m) return null;
  return String(m[2] || "").trim();
}

function findAllToolUseBlocks(text) {
  const s = String(text || "");
  const openTag = "<tool_use>";
  const closeTag = "</tool_use>";
  const blocks = [];

  let from = 0;
  while (true) {
    const start = s.indexOf(openTag, from);
    if (start < 0) break;
    const end = s.indexOf(closeTag, start + openTag.length);
    if (end < 0) return { ok: false, error: "tool_use 解析失败：缺少 </tool_use> 结束标签。" };
    blocks.push(s.slice(start, end + closeTag.length));
    from = end + closeTag.length;
  }

  return { ok: true, blocks };
}

function extractTagText(block, tagName) {
  const s = String(block || "");
  const openTag = `<${tagName}>`;
  const closeTag = `</${tagName}>`;
  const start = s.indexOf(openTag);
  if (start < 0) return { ok: false, error: `tool_use 解析失败：缺少 <${tagName}> 标签。` };
  const end = s.indexOf(closeTag, start + openTag.length);
  if (end < 0) return { ok: false, error: `tool_use 解析失败：缺少 </${tagName}> 标签。` };
  return { ok: true, text: s.slice(start + openTag.length, end) };
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

export function isAllowedVcardKind(value) {
  return ALLOWED_KINDS.includes(String(value || ""));
}

/**
 * 中文注释：
 * parseVcardModelOutput(text)
 * 作用：从模型输出解析 tool_use（<tool_use><name>..</name><parameters>..</parameters></tool_use>），并校验 kind
 * 约束：默认要求单个 tool_use；parameters 必须为 JSON 对象或数组；kind 在白名单内
 * 参数：
 *  - text: string（模型原始输出）
 * 返回：{ ok:boolean, items?:object[], error?:string }
 */
export function parseVcardModelOutput(text) {
  const raw = String(text || "").trim();
  if (!raw) return { ok: false, error: "空输出。" };

  const found = findAllToolUseBlocks(raw);
  if (!found.ok) return { ok: false, error: found.error };
  // 允许纯文本输出：当模型未调用任何工具时，视为“与用户对话/提问”，items 为空。
  if (found.blocks.length === 0) return { ok: true, items: [] };
  if (found.blocks.length > 1) return { ok: false, error: `输出不符合协议：tool_use 块过多（${found.blocks.length}）。请只输出 1 个。` };

  const block = found.blocks[0];
  const nameTag = extractTagText(block, "name");
  if (!nameTag.ok) return { ok: false, error: nameTag.error };
  const paramsTag = extractTagText(block, "parameters");
  if (!paramsTag.ok) return { ok: false, error: paramsTag.error };

  const toolName = String(nameTag.text || "").trim();
  const paramsRaw = String(paramsTag.text || "").trim();
  const paramsJsonText = extractFirstJsonCodeBlock(paramsRaw) || paramsRaw;

  const parsed = safeJsonParse(paramsJsonText);
  if (!parsed.ok) return { ok: false, error: `JSON 解析失败：${parsed.error}` };

  const value = parsed.value;
  const itemsRaw = Array.isArray(value) ? value : [value];

  const items = [];
  for (const it of itemsRaw) {
    if (!isPlainObject(it)) return { ok: false, error: "输出不符合协议：parameters 必须是对象或对象数组。" };
    const kind = String(it.kind || "").trim();
    if (kind) {
      items.push(it);
      continue;
    }
    if (!toolName) return { ok: false, error: "输出不符合协议：parameters.kind 为空，且 tool_use.name 为空。" };
    items.push({ ...it, kind: toolName });
  }

  const bad = items.find((x) => !isPlainObject(x) || !isAllowedVcardKind(x.kind));
  if (bad) return { ok: false, error: "输出不符合协议：kind 必须在白名单内。" };
  return { ok: true, items };
}
