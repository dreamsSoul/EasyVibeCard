/**
 * 文件：messages.js
 * 模块：server/use-cases/vcard/turn
 * 作用：构建 VCARD_CONTEXT 与 VCARD_CTRL 文本（供模型按协议输出）
 * 依赖：constants、normalize
 * @created 2026-01-07
 * @modified 2026-01-20
 */

import { VCARD_CTRL_PREFIX } from "./constants.js";
import { isPlainObject, normalizeText } from "./normalize.js";

function pickProgress(snapshot) {
  const p = snapshot?.meta?.progress;
  const obj = p && typeof p === "object" ? p : {};
  const stepIndex = Number(obj.stepIndex) || 1;
  const totalSteps = Number(obj.totalSteps) || (Array.isArray(obj.steps) ? obj.steps.length : 0) || 1;
  const stepName = normalizeText(obj.stepName) || "初始化";
  const nextActionText = normalizeText(obj?.nextAction?.text);
  return { stepIndex, totalSteps, stepName, nextActionText };
}

function buildPreview(list, getName) {
  const items = Array.isArray(list) ? list : [];
  const preview = items.slice(0, 8).map((x, i) => ({ i, name: normalizeText(getName(x)), enabled: Boolean(x?.enabled) })).filter((x) => x.name || x.enabled);
  return { preview, more: Math.max(0, items.length - preview.length) };
}

function buildWorldbookPreview(snapshot) {
  const entries = Array.isArray(snapshot?.worldbook?.entries) ? snapshot.worldbook.entries : [];
  const preview = entries
    .slice(0, 8)
    .map((e, i) => ({ i, comment: normalizeText(e?.comment), enabled: Boolean(e?.enabled), position: normalizeText(e?.position) }))
    .filter((x) => x.comment || x.enabled || x.position);
  return { preview, more: Math.max(0, entries.length - preview.length) };
}

function buildRawKeys(snapshot) {
  const dataExtensions = isPlainObject(snapshot?.raw?.dataExtensions) ? snapshot.raw.dataExtensions : {};
  return Object.keys(dataExtensions)
    .filter((k) => k !== "vibePlan")
    .slice(0, 24);
}

function buildToolUseExample(name, parameters) {
  return ["<tool_use>", `<name>${String(name || "").trim()}</name>`, "<parameters>", JSON.stringify(parameters, null, 2), "</parameters>", "</tool_use>"].join("\n");
}

function buildToolExamples({ root }) {
  const r = String(root || "角色名");
  return [
    "工具调用示例（当你需要系统执行动作时：请输出一个 <tool_use>...</tool_use>；parameters 必须是可解析 JSON）：",
    "",
    "1) 修改卡面/扩展字段（card.patch）：op 仅 set/remove；path 用点路径（card.* 或 raw.dataExtensions.vibePlan）",
    buildToolUseExample("card.patch", {
      patch: [
        { op: "set", path: "card.description", value: "（在此填写角色描述）" },
        {
          op: "set",
          path: "raw.dataExtensions.vibePlan",
          value: { version: "v1", goal: "（任务目标）", tasks: [{ id: "task_1", title: "任务 1", status: "todo" }], cursor: { currentTaskId: "task_1" } },
        },
      ],
    }),
    "",
    "（remove 示例：删除某个数组项 / 删除某个变量 key；注意 remove 仅支持有限范围）",
    buildToolUseExample("worldbook.patch", { patch: [{ op: "remove", path: "worldbook.entries[2]" }] }),
    "",
    buildToolUseExample("tavern_helper.patch", { patch: [{ op: "remove", path: "tavern_helper.variables.someKey" }] }),
    "",
    "2) 修改世界书（worldbook.patch）：按 patch[] 精确改动（建议优先用 worldbook.target）",
    buildToolUseExample("worldbook.patch", { patch: [{ op: "set", path: "worldbook.entries[0].content", value: "（世界书条目内容）" }] }),
    "",
    "3) 提交世界书目标态（worldbook.target）：直接给出 worldbook（含 entries 全量），系统会自动生成 diff 并应用",
    buildToolUseExample("worldbook.target", {
      worldbook: { name: `${r} Worldbook`, entries: [{ comment: "角色背景", content: "……", enabled: true, position: "before_char" }] },
    }),
    "",
    "4) 修改正则脚本（regex_scripts.patch / regex_scripts.set）",
    buildToolUseExample("regex_scripts.patch", { patch: [{ op: "set", path: "regex_scripts[0].find.pattern", value: "(?i)foo" }] }),
    "",
    buildToolUseExample("regex_scripts.set", {
      regex_scripts: [{ name: "示例脚本", find: { style: "raw", pattern: "foo", flags: "gi" }, replace: "bar", enabled: true }],
    }),
    "",
    "5) 修改 Tavern Helper（tavern_helper.patch / client_scripts.set）",
    buildToolUseExample("tavern_helper.patch", { patch: [{ op: "set", path: "tavern_helper.scripts[0].content", value: "// 脚本内容" }] }),
    "",
    buildToolUseExample("client_scripts.set", {
      tavern_helper: { scripts: [{ name: "脚本名", id: "script_1", enabled: true, content: "// ..." }], variables: { someKey: "someValue" } },
    }),
    "",
    "6) 一次输出多个 kind（数组）：一次提交多组 patch/set（仍然只输出 1 个 <tool_use>）",
    buildToolUseExample("batch", [
      { kind: "worldbook.patch", patch: [{ op: "set", path: "worldbook.entries[0].comment", value: "（更新备注）" }] },
      { kind: "regex_scripts.patch", patch: [{ op: "set", path: "regex_scripts[0].enabled", value: true }] },
    ]),
  ].join("\n");
}

export function buildVcardContextText(snapshot, mode) {
  const root = normalizeText(snapshot?.card?.name) || "角色名";
  const progress = pickProgress(snapshot);

  const worldbook = buildWorldbookPreview(snapshot);
  const regexScripts = buildPreview(snapshot?.regex_scripts, (s) => s?.name);
  const tavernScripts = buildPreview(snapshot?.tavern_helper?.scripts, (s) => s?.name || s?.id);
  const rawKeys = buildRawKeys(snapshot);
  const vibePlanIncluded = Boolean(isPlainObject(snapshot?.raw?.dataExtensions) && snapshot.raw.dataExtensions.vibePlan);

  const payload = {
    progress: { stepIndex: progress.stepIndex, totalSteps: progress.totalSteps, stepName: progress.stepName },
    fileTreePreview: {
      root,
      worldbook: { entries: worldbook.preview, more: worldbook.more },
      regex_scripts: { items: regexScripts.preview, more: regexScripts.more },
      tavern_helper: { scripts: tavernScripts.preview, more: tavernScripts.more },
      rawMeta: { dataExtensionsKeys: rawKeys, vibePlanIncluded },
    },
    hint: {
      note: "正文已通过“全文注入”提供；当你需要向用户提问/说明时，可直接输出纯文本（不需要 <tool_use>）。",
    },
  };

  return ["【VCARD_CONTEXT】", "```json", JSON.stringify(payload, null, 2), "```", "", buildToolExamples({ root })].join("\n");
}

function pickCtrlTitle(intent) {
  const t = String(intent || "run");
  if (t === "retry") return `${VCARD_CTRL_PREFIX}纠偏重试`;
  if (t === "continue") return `${VCARD_CTRL_PREFIX}继续`;
  return `${VCARD_CTRL_PREFIX}执行`;
}

export function buildVcardControlText({ snapshot, mode, reason, intent }) {
  const progress = pickProgress(snapshot);
  const task = normalizeText(reason) || progress.nextActionText || "请根据草稿看板补齐本步缺失内容，并推进到下一步。";

  const lines = [
    pickCtrlTitle(intent),
    "",
    `当前：Step ${progress.stepIndex}/${progress.totalSteps} - ${progress.stepName}`,
    `任务：${task}`,
    "",
    "工具使用约定（简版；示例见【VCARD_CONTEXT】）：",
    "1) 需要系统执行修改时：输出一个 <tool_use>...</tool_use>（块外不要解释；parameters 必须是可解析 JSON）。",
    "2) 只讨论/向用户提问/说明结论时：直接输出纯文本（不要输出 <tool_use>）。",
    "3) kind 支持：card.patch / worldbook.patch / worldbook.target / regex_scripts.patch / tavern_helper.patch / regex_scripts.set / client_scripts.set",
    "4) patch：kind=*.patch 必须包含 patch[]；op 仅 set/remove；set 需要 path+value；remove 仅 path（且仅支持有限范围）。",
    "5) worldbook.target：请提供 worldbook（含 entries 全量），系统会自动生成 diff 并应用。",
    "6) raw 约束：仅允许修改 raw.dataExtensions.vibePlan（任务清单）；且不允许与其他字段的修改混合（需要拆成两次）。",
    "7) 【USER_INPUT】标签：聊天历史中带有此标签的消息是用户的直接指令，必须优先响应。若用户指令与当前计划冲突，以用户指令为准。",
  ];

  return lines.join("\n").trim();
}
