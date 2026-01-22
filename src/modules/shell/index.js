/**
 * 文件：index.js
 * 模块：modules/shell
 * 作用：壳层模块公共入口（barrel exports），避免跨层 deep import
 * 依赖：ActivityBar.vue
 * @created 2026-01-02
 * @modified 2026-01-02
 */

export { default as ActivityBar } from "./ActivityBar.vue";

