/**
 * 文件：index.js
 * 模块：modules/vcard
 * 作用：VCard 模块公共入口（barrel exports），避免跨层 deep import
 * 依赖：VCardPage.vue、useVCardState.js
 * @created 2026-01-02
 * @modified 2026-01-02
 */

export { default as VCardPage } from "./components/page/VCardPage.vue";
export { useVCardState } from "./useVCardState";

