/**
 * 文件：deps.js
 * 模块：server/use-cases/vcard/turn
 * 作用：依赖断言与 RunLog 写入封装
 * 依赖：无
 * @created 2026-01-07
 * @modified 2026-01-07
 */

export function assertTurnDeps(deps) {
  const draftRepo = deps?.draftRepo;
  const chatRepo = deps?.chatRepo;
  const runRepo = deps?.runRepo;
  const pendingRepo = deps?.pendingRepo;
  const runLogRepo = deps?.runLogRepo;
  const idempotencyStore = deps?.idempotencyStore;
  const llmGateway = deps?.llmGateway;
  const llmStreamGateway = deps?.llmStreamGateway;
  const presetRepo = deps?.presetRepo;
  const settingsRepo = deps?.settingsRepo;

  if (!draftRepo?.getDraftMeta || !draftRepo?.getDraft || !draftRepo?.applyDraftPatch) throw new Error("draftRepo 未就绪。");
  if (!chatRepo?.getDraftChatPage || !chatRepo?.appendChatMessage) throw new Error("chatRepo 未就绪。");
  if (!runLogRepo?.createRunLog) throw new Error("runLogRepo 未就绪。");
  if (!pendingRepo?.getPending || !pendingRepo?.upsertPending || !pendingRepo?.deletePending) throw new Error("pendingRepo 未就绪。");
  if (!idempotencyStore?.get || !idempotencyStore?.setIfAbsent) throw new Error("idempotencyStore 未就绪。");
  if (!llmGateway?.callChat) throw new Error("llmGateway 未就绪。");
  if (!llmStreamGateway?.streamChat) throw new Error("llmStreamGateway 未就绪。");
  if (!presetRepo?.getPresetByName) throw new Error("presetRepo 未就绪。");
  if (!settingsRepo?.getSettings) throw new Error("settingsRepo 未就绪。");

  return { draftRepo, chatRepo, runRepo, pendingRepo, runLogRepo, idempotencyStore, llmGateway, llmStreamGateway, presetRepo, settingsRepo };
}

export async function writeSuccessRunLog({
  runLogRepo,
  draftId,
  requestId,
  runId,
  turnIndex,
  mode,
  reason,
  baseVersion,
  version,
  provider,
  stream,
  upstreamStream,
  readRounds,
  kinds,
  changedPaths,
  assistantText,
}) {
  return await runLogRepo.createRunLog({
    draftId,
    requestId,
    runId,
    turnIndex,
    mode,
    reason,
    baseVersion,
    version,
    ok: true,
    code: null,
    error: "",
    provider,
    stream,
    upstreamStream,
    readRounds,
    kinds,
    changedPaths,
    assistantChars: String(assistantText || "").length,
  });
}

export async function writeFailureRunLog({
  runLogRepo,
  draftId,
  requestId,
  runId,
  turnIndex,
  mode,
  reason,
  baseVersion,
  provider,
  stream,
  upstreamStream,
  readRounds,
  code,
  error,
}) {
  return await runLogRepo.createRunLog({
    draftId,
    requestId,
    runId,
    turnIndex,
    mode,
    reason,
    baseVersion,
    version: null,
    ok: false,
    code,
    error,
    provider,
    stream,
    upstreamStream,
    readRounds: Number(readRounds) || 0,
    kinds: [],
    changedPaths: [],
    assistantChars: 0,
  });
}
