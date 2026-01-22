/**
 * 文件：upstreamConfig.js
 * 模块：server/shared
 * 作用：上游连接参数归一化（provider/baseUrl/apiKey/region/projectId）
 * 依赖：无
 * @created 2026-01-07
 * @modified 2026-01-07
 */

const PROVIDERS = Object.freeze({
  OPENAI: "openai",
  CLAUDE: "claude",
  MAKERSUITE: "makersuite",
  VERTEXAI: "vertexai",
});

function normalizeText(value) {
  return String(value ?? "").trim();
}

export function normalizeProvider(value) {
  const raw = normalizeText(value).toLowerCase();
  if (raw === PROVIDERS.CLAUDE) return PROVIDERS.CLAUDE;
  if (raw === PROVIDERS.MAKERSUITE || raw === "gemini") return PROVIDERS.MAKERSUITE;
  if (raw === PROVIDERS.VERTEXAI || raw === "vertex") return PROVIDERS.VERTEXAI;
  return PROVIDERS.OPENAI;
}

export function normalizeBaseUrl(baseUrl) {
  const trimmed = normalizeText(baseUrl).replace(/\/$/, "");
  const u = new URL(trimmed);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Upstream Base URL 必须是 http/https。");
  return u.toString().replace(/\/$/, "");
}

export function pickUpstream(rawUpstream) {
  const provider = normalizeProvider(rawUpstream?.provider);
  const baseUrlFromBody = normalizeText(rawUpstream?.baseUrl);
  const apiKeyFromBody = normalizeText(rawUpstream?.apiKey);
  const region = normalizeText(rawUpstream?.region);
  const projectId = normalizeText(rawUpstream?.projectId);

  const baseUrlFromEnv =
    provider === PROVIDERS.CLAUDE
      ? normalizeText(process.env.CLAUDE_BASE_URL)
      : provider === PROVIDERS.MAKERSUITE
        ? normalizeText(process.env.GEMINI_BASE_URL)
        : provider === PROVIDERS.VERTEXAI
          ? normalizeText(process.env.VERTEX_BASE_URL)
          : normalizeText(process.env.UPSTREAM_BASE_URL);

  const apiKeyFromEnv =
    provider === PROVIDERS.CLAUDE
      ? normalizeText(process.env.CLAUDE_API_KEY)
      : provider === PROVIDERS.MAKERSUITE
        ? normalizeText(process.env.GEMINI_API_KEY)
        : provider === PROVIDERS.VERTEXAI
          ? normalizeText(process.env.VERTEX_API_KEY)
          : normalizeText(process.env.UPSTREAM_API_KEY);

  return {
    provider,
    baseUrl: baseUrlFromBody || baseUrlFromEnv,
    apiKey: apiKeyFromBody || apiKeyFromEnv,
    region: provider === PROVIDERS.VERTEXAI ? region : "",
    projectId: provider === PROVIDERS.VERTEXAI ? projectId : "",
  };
}

export const UPSTREAM_PROVIDERS = Object.freeze({
  OPENAI: PROVIDERS.OPENAI,
  CLAUDE: PROVIDERS.CLAUDE,
  MAKERSUITE: PROVIDERS.MAKERSUITE,
  VERTEXAI: PROVIDERS.VERTEXAI,
});

