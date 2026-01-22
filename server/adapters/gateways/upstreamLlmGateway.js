/**
 * 文件：upstreamLlmGateway.js
 * 模块：server/adapters/gateways
 * 作用：调用上游 LLM（复用 providers，统一归一化与错误包装）
 * 依赖：server/providers/*
 * @created 2026-01-07
 * @modified 2026-01-20
 */

import { proxyClaudeMessages } from "../../providers/claude.js";
import { proxyGemini } from "../../providers/gemini.js";
import { proxyOpenAIChatCompletions } from "../../providers/openai.js";
import { normalizeBaseUrl, pickUpstream, UPSTREAM_PROVIDERS } from "../../shared/upstreamConfig.js";

function toPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

function pickDebugMeta(providerResult) {
  const dbg = toPlainObject(providerResult?.debug);
  return dbg ? { latencyMs: dbg.latencyMs, status: dbg.status } : {};
}

/**
 * 中文注释：
 * createUpstreamLlmGateway({ req, res })
 * 作用：创建请求级 LLM Gateway（支持 AbortOnClose/外部 AbortSignal；仅实现非流式上游调用）
 * 约束：不落库、不记录 apiKey 明文；requestBody.stream 强制为 false
 * 参数：
 *  - req/res: Express req/res（用于连接中断 abort）
 * 返回：{ callChat }
 */
export function createUpstreamLlmGateway({ req, res }) {
  const callChat = async ({ upstream, requestBody, providerOptions, abortSignal }) => {
    const picked = pickUpstream(upstream || {});
    const provider = String(picked?.provider || UPSTREAM_PROVIDERS.OPENAI);
    const body = { ...(requestBody || {}), stream: false };

    if (provider === UPSTREAM_PROVIDERS.OPENAI) {
      if (!picked.baseUrl) return { ok: false, assistantText: "", error: "OpenAI Base URL 不能为空。", debug: {} };
      const baseUrl = normalizeBaseUrl(picked.baseUrl);
      const r = await proxyOpenAIChatCompletions({ req, res, upstream: { ...picked, baseUrl }, requestBody: body, abortSignal });
      return { ok: Boolean(r.ok), assistantText: String(r.assistantText || ""), error: r.error || "", debug: pickDebugMeta(r) };
    }

    if (provider === UPSTREAM_PROVIDERS.CLAUDE) {
      const baseUrl = picked?.baseUrl ? normalizeBaseUrl(picked.baseUrl) : picked?.baseUrl;
      const r = await proxyClaudeMessages({ req, res, upstream: { ...picked, baseUrl }, requestBody: body, providerOptions, abortSignal });
      return { ok: Boolean(r.ok), assistantText: String(r.assistantText || ""), error: r.error || "", debug: pickDebugMeta(r) };
    }

    if (provider === UPSTREAM_PROVIDERS.MAKERSUITE || provider === UPSTREAM_PROVIDERS.VERTEXAI) {
      const baseUrl = picked?.baseUrl ? normalizeBaseUrl(picked.baseUrl) : picked?.baseUrl;
      const r = await proxyGemini({ req, res, provider, upstream: { ...picked, baseUrl }, requestBody: body, providerOptions, abortSignal });
      return { ok: Boolean(r.ok), assistantText: String(r.assistantText || ""), error: r.error || "", debug: pickDebugMeta(r) };
    }

    if (!picked.baseUrl) return { ok: false, assistantText: "", error: "Upstream Base URL 不能为空。", debug: {} };
    const baseUrl = normalizeBaseUrl(picked.baseUrl);
    const r = await proxyOpenAIChatCompletions({ req, res, upstream: { ...picked, baseUrl }, requestBody: body, abortSignal });
    return { ok: Boolean(r.ok), assistantText: String(r.assistantText || ""), error: r.error || "", debug: pickDebugMeta(r) };
  };

  return { callChat };
}
