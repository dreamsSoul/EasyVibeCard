/**
 * 文件：index.js
 * 模块：modules/settings
 * 作用：设置模块公共入口（barrel exports），避免跨层 deep import
 * 依赖：SettingsView.vue
 * @created 2026-01-02
 * @modified 2026-01-02
 */

export { default as SettingsView } from "./SettingsView.vue";

