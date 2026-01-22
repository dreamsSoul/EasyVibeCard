/**
 * 文件：interactors.js
 * 模块：server/use-cases/chat
 * 作用：Chat 用例（分页读取）
 * 依赖：无
 * @created 2026-01-07
 * @modified 2026-01-20
 */

import { applyOutputCleaner } from "../../entities/vcard/outputCleaner.js";

function toIntStrict(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

/**
 * 中文注释：
 * getDraftChatInteractor({ chatRepo, draftId, beforeSeq, limit })
 * 作用：读取草稿 chat 的分页数据（服务端真源）
 * 约束：limit 默认 50，最大 200；beforeSeq 可选（不传表示从最新往回取）
 * 参数：
 *  - chatRepo: { getDraftChatPage }
 *  - draftId: string
 *  - beforeSeq: number|undefined
 *  - limit: number|undefined
 * 返回：Promise<{ draftId, version, headSeq, items }>
 */
function normalizeView(value) {
  return String(value || "").trim() === "cleaned" ? "cleaned" : "raw";
}

function shouldApplyCleaner(settings) {
  const oc = settings?.vcard?.outputCleaner && typeof settings.vcard.outputCleaner === "object" ? settings.vcard.outputCleaner : {};
  const cfg = oc?.config && typeof oc.config === "object" ? oc.config : null;
  if (!cfg || !cfg.enabled) return false;
  if (!Array.isArray(cfg.rules) || cfg.rules.length === 0) return false;
  return true;
}

function applyCleanerToItems(items, cfg) {
  const list = Array.isArray(items) ? items : [];
  return list.map((m) => {
    if (m?.role !== "assistant") return m;
    const res = applyOutputCleaner(String(m.content || ""), cfg);
    return { ...m, content: res.text };
  });
}

/**
 * 中文注释：
 * getDraftChatInteractor({ chatRepo, settingsRepo, draftId, beforeSeq, limit, view })
 * 作用：读取草稿 chat 的分页数据（支持 view=raw/cleaned）
 * 约束：cleaned 仅影响返回内容，不落库
 * 参数：
 *  - chatRepo: { getDraftChatPage }
 *  - settingsRepo: { getSettings } | undefined
 *  - draftId: string
 *  - beforeSeq: number|undefined
 *  - limit: number|undefined
 *  - view: string|undefined
 * 返回：Promise<{ draftId, version, headSeq, items }>
 */
export async function getDraftChatInteractor({ chatRepo, settingsRepo, draftId, beforeSeq, limit, view }) {
  if (!chatRepo?.getDraftChatPage) throw new Error("chatRepo.getDraftChatPage 缺失。");
  const page = await chatRepo.getDraftChatPage({
    draftId,
    beforeSeq: toIntStrict(beforeSeq),
    limit: toIntStrict(limit),
  });

  if (normalizeView(view) !== "cleaned") return page;
  if (!settingsRepo?.getSettings) return page;

  const settings = await settingsRepo.getSettings().catch(() => null);
  if (!shouldApplyCleaner(settings)) return page;
  const cfg = settings?.vcard?.outputCleaner?.config;
  return { ...page, items: applyCleanerToItems(page.items, cfg) };
}
