import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";

interface CrofModel {
  id: string;
  name?: string;
  context_length?: number;
  max_completion_tokens?: number;
  reasoning_effort?: boolean;
  pricing?: {
    prompt?: string;
    completion?: string;
    cache_prompt?: string;
  };
}

const FALLBACK_MODELS: ProviderModelConfig[] = [
  {
    id: "crofai-default",
    name: "CrofAI (connect via /login)",
    reasoning: false,
    input: ["text"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131072,
    maxTokens: 4096,
  },
];

async function fetchCrofModels(apiKey: string): Promise<ProviderModelConfig[]> {
  const res = await fetch("https://crof.ai/v1/models", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) return [];

  let body: { data: CrofModel[] };
  try {
    body = (await res.json()) as { data: CrofModel[] };
  } catch {
    return [];
  }
  if (!Array.isArray(body.data)) return [];

  return body.data.map(
    (m): ProviderModelConfig => ({
      id: m.id,
      name: m.name ?? m.id,
      reasoning: !!m.reasoning_effort,
      input: ["text"] as ("text" | "image")[],
      cost: {
        input: parseFloat(m.pricing?.prompt ?? "0") || 0,
        output: parseFloat(m.pricing?.completion ?? "0") || 0,
        cacheRead: parseFloat(m.pricing?.cache_prompt ?? "0") || 0,
        cacheWrite: 0,
      },
      contextWindow: m.context_length ?? 131072,
      maxTokens: m.max_completion_tokens ?? 4096,
    }),
  );
}

export default async function (pi: ExtensionAPI): Promise<void> {
  // Try to fetch real models; fall back to placeholder so the provider
  // appears in modelRegistry.getAll() and thus in /login's provider list
  let initialModels: ProviderModelConfig[] = FALLBACK_MODELS;
  const envKey = process.env.CROFAI_API_KEY;
  if (envKey) {
    try {
      const live = await fetchCrofModels(envKey);
      if (live.length > 0) initialModels = live;
    } catch {
      // Network error — keep fallback
    }
  }

  // ── Provider registration ──────────────────────────────────────────
  pi.registerProvider("CrofAI", {
    name: "CrofAI",
    baseUrl: "https://crof.ai/v1",
    api: "openai-completions",
    authHeader: true,
    apiKey: "$CROFAI_API_KEY",
    models: initialModels,
  });

  // ── Command registration ───────────────────────────────────────────
  pi.registerCommand("refresh-crof", {
    description: "Force refresh CrofAI models from the API (bypass 24h cache)",
    handler: async (_args: string, ctx) => {
      ctx.ui.notify("Refreshing CrofAI models...", "info");
      try {
        const apiKey =
          await ctx.modelRegistry.getApiKeyForProvider("CrofAI");
        if (!apiKey) {
          ctx.ui.notify(
            "No API key configured. Set CROFAI_API_KEY env var or run /login.",
            "error",
          );
          return;
        }
        const models = await fetchCrofModels(apiKey);
        if (models.length === 0) {
          ctx.ui.notify("No models returned from API. Check your API key.", "error");
          return;
        }
        pi.registerProvider("CrofAI", { models });
        ctx.ui.notify("CrofAI models refreshed!", "info");
      } catch (err) {
        ctx.ui.notify(
          `Refresh failed: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      }
    },
  });
}
