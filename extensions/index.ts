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
  // Pre-fetch models if CROFAI_API_KEY env var is set
  let initialModels: ProviderModelConfig[] = [];
  const envKey = process.env.CROFAI_API_KEY;
  if (envKey) {
    try {
      initialModels = await fetchCrofModels(envKey);
    } catch {
      // Network error — start with empty models
    }
  }

  // ── Provider registration ──────────────────────────────────────────
  pi.registerProvider("CrofAI", {
    baseUrl: "https://crof.ai/v1",
    api: "openai-completions",
    authHeader: true,

    oauth: {
      name: "CrofAI",

      login: async (callbacks) => {
        const key = await callbacks.onPrompt({
          message: "Enter your CrofAI API key:",
          placeholder: "sk-crof-...",
        });
        return {
          access: key,
          refresh: key,
          expires: Date.now() + 365 * 24 * 60 * 60 * 1000,
        };
      },

      getApiKey: (credentials) => credentials.access,

      refreshToken: async (credentials) => credentials,
    },

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
            "No API key configured. Run /login and select CrofAI.",
            "error",
          );
          return;
        }
        const models = await fetchCrofModels(apiKey);
        if (models.length === 0) {
          ctx.ui.notify("No models returned from API. Check your API key.", "error");
          return;
        }
        pi.registerProvider("CrofAI", {
          baseUrl: "https://crof.ai/v1",
          api: "openai-completions",
          models,
        });
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
