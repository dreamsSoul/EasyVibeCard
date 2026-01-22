/**
 * 文件：index.js
 * 模块：modules/chat
 * 作用：聊天模块公共入口（barrel exports），避免跨层 deep import
 * 依赖：ChatView.vue、useChatState.js
 * @created 2026-01-02
 * @modified 2026-01-02
 */

export { default as ChatView } from "./ChatView.vue";
export { useChatState } from "./useChatState";

