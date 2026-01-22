/**
 * 文件：chatCompletions.js
 * 模块：server/routes
 * 作用：挂载 /api/chat/completions（请求归一化 + provider 分发 + debug 回传）
 * 依赖：express、server/providers/*
 * @created 2026-01-01
 * @modified 2026-01-01
 */

import { proxyOpenAIChatCompletions } from "../providers/openai.js";
import { proxyClaudeMessages } from "../providers/claude.js";
import { proxyGemini } from "../providers/gemini.js";

const PROVIDERS = Object.freeze({
  OPENAI: "openai",
  CLAUDE: "claude",
  MAKERSUITE: "makersuite",
  VERTEXAI: "vertexai",
});

function maskKey(key) {
  const k = String(key || "");
  if (!k) return "";
  if (k.length <= 8) return `${k.slice(0, 2)}****${k.slice(-2)}`;
  return `${k.slice(0, 4)}****${k.slice(-4)}`;
}

function safeJson(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return null;
  }
}

function normalizeProvider(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === PROVIDERS.CLAUDE) return PROVIDERS.CLAUDE;
  if (raw === PROVIDERS.MAKERSUITE || raw === "gemini") return PROVIDERS.MAKERSUITE;
  if (raw === PROVIDERS.VERTEXAI || raw === "vertex") return PROVIDERS.VERTEXAI;
  return PROVIDERS.OPENAI;
}

function pickUpstream(reqBody) {
  const provider = normalizeProvider(reqBody?.upstream?.provider);

  const baseUrlFromBody = String(reqBody?.upstream?.baseUrl || "").trim();
  const apiKeyFromBody = String(reqBody?.upstream?.apiKey || "").trim();
  const region = String(reqBody?.upstream?.region || "").trim();
  const projectId = String(reqBody?.upstream?.projectId || "").trim();

  const baseUrlFromEnv =
    provider === PROVIDERS.CLAUDE
      ? String(process.env.CLAUDE_BASE_URL || "")
      : provider === PROVIDERS.MAKERSUITE
        ? String(process.env.GEMINI_BASE_URL || "")
        : provider === PROVIDERS.VERTEXAI
          ? String(process.env.VERTEX_BASE_URL || "")
          : String(process.env.UPSTREAM_BASE_URL || "");

  const apiKeyFromEnv =
    provider === PROVIDERS.CLAUDE
      ? String(process.env.CLAUDE_API_KEY || "")
      : provider === PROVIDERS.MAKERSUITE
        ? String(process.env.GEMINI_API_KEY || "")
        : provider === PROVIDERS.VERTEXAI
          ? String(process.env.VERTEX_API_KEY || "")
          : String(process.env.UPSTREAM_API_KEY || "");

  return {
    provider,
    baseUrl: baseUrlFromBody || baseUrlFromEnv,
    apiKey: apiKeyFromBody || apiKeyFromEnv,
    region,
    projectId,
  };
}

function normalizeBaseUrl(baseUrl) {
  const trimmed = String(baseUrl || "").trim().replace(/\/$/, "");
  const u = new URL(trimmed);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Upstream Base URL 必须是 http/https。");
  return u.toString().replace(/\/$/, "");
}

function normalizeChatRequest(reqBody) {
  const body = reqBody?.request || {};
  const model = String(body.model || "").trim();
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const temperature = typeof body.temperature === "number" ? body.temperature : undefined;
  const top_p = typeof body.top_p === "number" ? body.top_p : undefined;
  const top_k = Number.isFinite(Number(body.top_k)) ? Math.max(0, Math.trunc(Number(body.top_k))) : undefined;
  const max_tokens = Number.isFinite(Number(body.max_tokens)) ? Math.max(0, Math.trunc(Number(body.max_tokens))) : undefined;
  const stream = Boolean(body.stream);

  if (!model) throw new Error("request.model 不能为空。");
  if (messages.length === 0) throw new Error("request.messages 不能为空。");

  const cleanMessages = messages
    .filter((m) => m && (m.role === "system" || m.role === "user" || m.role === "assistant"))
    .map((m) => ({ role: m.role, content: String(m.content || "") }));

  return { model, messages: cleanMessages, temperature, top_p, top_k, max_tokens, stream };
}

function normalizeProviderOptions(reqBody) {
  const opt = reqBody?.providerOptions || {};
  const useSystemPrompt = opt.useSystemPrompt === undefined ? true : Boolean(opt.useSystemPrompt);
  const reasoningEffort = String(opt.reasoningEffort || "auto");
  const includeReasoning = Boolean(opt.includeReasoning);
  return { useSystemPrompt, reasoningEffort, includeReasoning };
}

function buildDebug({ upstream, requestBody, providerOptions, providerResult }) {
  return {
    upstream: {
      provider: upstream.provider,
      baseUrl: upstream.baseUrl || "",
      apiKey: maskKey(upstream.apiKey),
      region: upstream.region || "",
      projectId: upstream.projectId ? "***" : "",
    },
    request: safeJson({ request: requestBody, providerOptions }),
    response: safeJson(providerResult?.debug || null),
  };
}

async function handleChatCompletions(req, res) {
  const upstream = pickUpstream(req.body);
  const providerOptions = normalizeProviderOptions(req.body);
  const requestBody = normalizeChatRequest(req.body);

  const ensureBaseUrl = (value) => normalizeBaseUrl(value);
  if (upstream.provider === PROVIDERS.OPENAI) upstream.baseUrl = ensureBaseUrl(upstream.baseUrl);
  if (upstream.provider === PROVIDERS.CLAUDE && upstream.baseUrl) upstream.baseUrl = ensureBaseUrl(upstream.baseUrl);
  if (upstream.provider === PROVIDERS.MAKERSUITE && upstream.baseUrl) upstream.baseUrl = ensureBaseUrl(upstream.baseUrl);
  if (upstream.provider === PROVIDERS.VERTEXAI && upstream.baseUrl) upstream.baseUrl = ensureBaseUrl(upstream.baseUrl);

  const callProvider = async () => {
    if (upstream.provider === PROVIDERS.CLAUDE) {
      return proxyClaudeMessages({ req, res, upstream, requestBody, providerOptions });
    }
    if (upstream.provider === PROVIDERS.MAKERSUITE || upstream.provider === PROVIDERS.VERTEXAI) {
      return proxyGemini({ req, res, provider: upstream.provider, upstream, requestBody, providerOptions });
    }
    return proxyOpenAIChatCompletions({ req, res, upstream, requestBody });
  };

  const providerResult = await callProvider();
  const debug = buildDebug({ upstream, requestBody, providerOptions, providerResult });

  if (requestBody.stream) {
    if (!providerResult.ok) return res.status(502).json({ ok: false, error: providerResult.error || "上游错误", debug });
    return;
  }

  if (!providerResult.ok) return res.status(502).json({ ok: false, error: providerResult.error || "上游错误", debug });
  return res.json({ ok: true, assistantText: providerResult.assistantText || "", debug });
}

export function attachChatCompletionsRoutes(app) {
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.post("/api/chat/completions", async (req, res) => {
    try {
      await handleChatCompletions(req, res);
    } catch (err) {
      return res.status(400).json({ ok: false, error: String(err?.message || err) });
    }
  });
}

