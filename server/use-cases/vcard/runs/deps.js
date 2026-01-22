/**
 * 文件：deps.js
 * 模块：server/use-cases/vcard/runs
 * 作用：依赖断言（Run/RunEvents/Draft/Chat/RunLog/Idempotency）
 * 依赖：无
 * @created 2026-01-08
 * @modified 2026-01-08
 */

export function assertRunDeps(deps) {
  const draftRepo = deps?.draftRepo;
  const chatRepo = deps?.chatRepo;
  const runRepo = deps?.runRepo;
  const runEventRepo = deps?.runEventRepo;
  const runLogRepo = deps?.runLogRepo;
  const pendingRepo = deps?.pendingRepo;
  const idempotencyStore = deps?.idempotencyStore;
  const presetRepo = deps?.presetRepo;
  const settingsRepo = deps?.settingsRepo;

  if (!draftRepo?.getDraftMeta || !draftRepo?.getDraft) throw new Error("draftRepo 未就绪。");
  if (!chatRepo?.appendChatMessage || !chatRepo?.getDraftChatPage) throw new Error("chatRepo 未就绪。");
  if (!runRepo?.createRun || !runRepo?.getRun || !runRepo?.findRunningByDraftId || !runRepo?.stopRun || !runRepo?.updateProgress) throw new Error("runRepo 未就绪。");
  if (!runEventRepo?.appendEvent || !runEventRepo?.listEventsAfter || !runEventRepo?.getLatestEventMeta || !runEventRepo?.getLatestEventByType) {
    throw new Error("runEventRepo 未就绪。");
  }
  if (!runLogRepo?.createRunLog) throw new Error("runLogRepo 未就绪。");
  if (!pendingRepo?.getPending || !pendingRepo?.upsertPending || !pendingRepo?.deletePending) throw new Error("pendingRepo 未就绪。");
  if (!idempotencyStore?.get || !idempotencyStore?.setIfAbsent) throw new Error("idempotencyStore 未就绪。");
  if (!presetRepo?.getPresetByName) throw new Error("presetRepo 未就绪。");
  if (!settingsRepo?.getSettings) throw new Error("settingsRepo 未就绪。");

  return { draftRepo, chatRepo, runRepo, runEventRepo, runLogRepo, pendingRepo, idempotencyStore, presetRepo, settingsRepo };
}
