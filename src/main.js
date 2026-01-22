/**
 * 文件：main.js
 * 模块：前端入口
 * 作用：挂载 Vue 应用
 * 依赖：Vue3
 * @created 2025-12-28
 * @modified 2025-12-28
 */

import { createApp } from "vue";
import App from "./App.vue";
import "./styles/base.css";

createApp(App).mount("#app");

