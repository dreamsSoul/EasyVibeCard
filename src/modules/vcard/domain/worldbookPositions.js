/**
 * 文件：worldbookPositions.js
 * 模块：vcard/domain
 * 作用：世界书 10 个插入位置的内部枚举与 ST 映射
 * 依赖：无
 * @created 2025-12-29
 * @modified 2026-01-01
 */

export const WORLDBOOK_POSITION_KEYS = Object.freeze([
  "before_char",
  "after_char",
  "before_author_note",
  "after_author_note",
  "at_depth_system",
  "at_depth_user",
  "at_depth_assistant",
  "before_example_messages",
  "after_example_messages",
  "outlet",
]);

export const WORLDBOOK_POSITION_LABEL = Object.freeze({
  before_char: "角色定义前",
  after_char: "角色定义后",
  before_author_note: "作者注释前",
  after_author_note: "作者注释后",
  at_depth_system: "指定深度（system）",
  at_depth_user: "指定深度（user）",
  at_depth_assistant: "指定深度（assistant）",
  before_example_messages: "示例消息前",
  after_example_messages: "示例消息后",
  outlet: "Outlet 注入",
});

export function isWorldbookPositionKey(value) {
  return WORLDBOOK_POSITION_KEYS.includes(String(value || ""));
}

export function isAtDepthPositionKey(value) {
  const k = String(value || "");
  return k === "at_depth_system" || k === "at_depth_user" || k === "at_depth_assistant";
}

/**
 * 中文注释：
 * toStWorldbookPosition(positionKey)
 * 作用：把内部 10 位置 key 映射为 SillyTavern 的 position/role
 * 约束：positionKey 必须是内部枚举；atDepth 需要 role（0/1/2）
 * 参数：
 *  - positionKey: string（内部位置 key）
 * 返回：{ position:number, role?:number }（用于 entry.extensions）
 */
export function toStWorldbookPosition(positionKey) {
  const key = String(positionKey || "");
  switch (key) {
    case "before_char":
      return { position: 0 };
    case "after_char":
      return { position: 1 };
    case "before_author_note":
      return { position: 2 };
    case "after_author_note":
      return { position: 3 };
    case "at_depth_system":
      return { position: 4, role: 0 };
    case "at_depth_user":
      return { position: 4, role: 1 };
    case "at_depth_assistant":
      return { position: 4, role: 2 };
    case "before_example_messages":
      return { position: 5 };
    case "after_example_messages":
      return { position: 6 };
    case "outlet":
      return { position: 7 };
    default:
      return { position: 1 };
  }
}

/**
 * 中文注释：
 * fromStWorldbookPosition(position, role)
 * 作用：把 ST 的 position/role 反解到内部 10 位置 key
 * 约束：position=4 时需要 role；未知值回退到 after_char
 * 参数：
 *  - position: any（ST position）
 *  - role: any（ST role，仅 position=4 有意义）
 * 返回：string（内部位置 key）
 */
export function fromStWorldbookPosition(position, role) {
  const pos = Number(position);
  if (!Number.isFinite(pos)) return "after_char";
  if (pos === 0) return "before_char";
  if (pos === 1) return "after_char";
  if (pos === 2) return "before_author_note";
  if (pos === 3) return "after_author_note";
  if (pos === 5) return "before_example_messages";
  if (pos === 6) return "after_example_messages";
  if (pos === 7) return "outlet";
  if (pos !== 4) return "after_char";

  const r = Number(role);
  if (r === 0) return "at_depth_system";
  if (r === 1) return "at_depth_user";
  if (r === 2) return "at_depth_assistant";
  return "at_depth_user";
}
