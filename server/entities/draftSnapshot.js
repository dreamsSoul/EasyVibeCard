/**
 * 文件：draftSnapshot.js
 * 模块：server/entities
 * 作用：DraftSnapshot（草稿快照）默认结构（与前端 CardDraft 对齐）
 * 依赖：无
 * @created 2026-01-07
 * @modified 2026-01-07
 */

function nowIso() {
  return new Date().toISOString();
}

/**
 * 中文注释：
 * createEmptyDraftSnapshot()
 * 作用：创建一个最小稳定的 DraftSnapshot（用于 drafts.create 的初始版本）
 * 约束：结构需与前端 vcard/domain/cardDraft 的统一形保持一致
 * 参数：无
 * 返回：object（DraftSnapshot）
 */
export function createEmptyDraftSnapshot() {
  return {
    meta: {
      spec: "chara_card_v3",
      spec_version: "3.0",
      updatedAt: nowIso(),
      progress: { stepIndex: 1, stepName: "初始化" },
    },
    card: {
      name: "",
      description: "",
      personality: "",
      scenario: "",
      first_mes: "",
      mes_example: "",
      creator_notes: "",
      system_prompt: "",
      post_history_instructions: "",
      alternate_greetings: [],
      tags: [],
    },
    worldbook: { name: "", entries: [] },
    regex_scripts: [],
    tavern_helper: { scripts: [], variables: {} },
    validation: { errors: [], warnings: [] },
    raw: { dataExtensions: {} },
  };
}

