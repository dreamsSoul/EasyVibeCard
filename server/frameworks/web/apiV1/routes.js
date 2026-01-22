/**
 * 文件：routes.js
 * 模块：server/frameworks/web/apiV1
 * 作用：挂载 /api/v1 路由（从这里开始接入 Clean Architecture）
 * 依赖：sendResponse
 * @created 2026-01-07
 * @modified 2026-01-07
 */

import { sendError, sendOk } from "../sendResponse.js";

import { createSqliteAppSettingsRepository } from "../../../adapters/gateways/sqliteAppSettingsRepository.js";
import { createSqliteChatRepository } from "../../../adapters/gateways/sqliteChatRepository.js";
import { createSqliteChatThreadRepository } from "../../../adapters/gateways/sqliteChatThreadRepository.js";
import { createSqliteDraftRepository } from "../../../adapters/gateways/sqliteDraftRepository.js";
import { createSqliteDraftPendingActionRepository } from "../../../adapters/gateways/sqliteDraftPendingActionRepository.js";
import { createSqliteIdempotencyStore } from "../../../adapters/gateways/sqliteIdempotencyStore.js";
import { createSqlitePresetRepository } from "../../../adapters/gateways/sqlitePresetRepository.js";
import { createSqliteRunEventRepository } from "../../../adapters/gateways/sqliteRunEventRepository.js";
import { createSqliteRunLogRepository } from "../../../adapters/gateways/sqliteRunLogRepository.js";
import { createSqliteRunRepository } from "../../../adapters/gateways/sqliteRunRepository.js";
import { attachChatThreadRoutes } from "./chatThreadsRoutes.js";
import { attachDraftRoutes } from "./draftsRoutes.js";
import { attachPresetRoutes } from "./presetsRoutes.js";
import { attachSettingsRoutes } from "./settingsRoutes.js";
import { attachVcardRoutes } from "./vcardRoutes.js";
import { attachVcardPendingRoutes } from "./vcardPendingRoutes.js";
import { attachVcardRunRoutes } from "./vcardRunsRoutes.js";

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/**
 * 中文注释：
 * attachApiV1Routes(app, deps)
 * 作用：挂载 /api/v1 路由与统一错误处理
 * 约束：deps.db 必须为 initAppDb 初始化后的连接
 * 参数：
 *  - app: any（Express app）
 *  - deps: { db: any, migrated?: { applied: string[], skipped: string[] } }
 * 返回：void
 */
export function attachApiV1Routes(app, deps) {
  const draftRepo = createSqliteDraftRepository(deps?.db);
  const chatRepo = createSqliteChatRepository(deps?.db);
  const chatThreadRepo = createSqliteChatThreadRepository(deps?.db);
  const presetRepo = createSqlitePresetRepository(deps?.db);
  const settingsRepo = createSqliteAppSettingsRepository(deps?.db);
  const pendingRepo = createSqliteDraftPendingActionRepository(deps?.db);
  const runLogRepo = createSqliteRunLogRepository(deps?.db);
  const idempotencyStore = createSqliteIdempotencyStore(deps?.db);
  const runRepo = createSqliteRunRepository(deps?.db);
  const runEventRepo = createSqliteRunEventRepository(deps?.db);

  app.get(
    "/api/v1/health",
    asyncHandler(async (_req, res) => {
      return sendOk(res, { status: "ok", migrated: deps?.migrated ?? undefined });
    }),
  );

  attachSettingsRoutes(app, { settingsRepo });
  attachPresetRoutes(app, { presetRepo });
  attachChatThreadRoutes(app, { chatThreadRepo, presetRepo, settingsRepo });
  attachDraftRoutes(app, { draftRepo, chatRepo, runRepo, settingsRepo });
  attachVcardRoutes(app, { draftRepo, chatRepo, runRepo, runLogRepo, idempotencyStore, presetRepo, settingsRepo, pendingRepo });
  attachVcardPendingRoutes(app, { draftRepo, runRepo, pendingRepo });
  attachVcardRunRoutes(app, { draftRepo, chatRepo, runRepo, runEventRepo, runLogRepo, idempotencyStore, presetRepo, settingsRepo, pendingRepo });

  // 统一错误出口（仅影响 /api/v1 前缀）
  app.use("/api/v1", (err, req, res, _next) => sendError(req, res, err));
}
