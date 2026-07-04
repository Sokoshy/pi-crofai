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
        input: +(m.pricing?.prompt ?? 0) || 0,
        output: +(m.pricing?.completion ?? 0) || 0,
        cacheRead: +(m.pricing?.cache_prompt ?? 0) || 0,
        cacheWrite: 0,
      },
      contextWindow: m.context_length ?? 131072,
      maxTokens: m.max_completion_tokens ?? 4096,
    }),
  );
}

function crofProviderConfig(models: ProviderModelConfig[]) {
  return {
    baseUrl: "https://crof.ai/v1",
    api: "openai-completions" as const,
    authHeader: true,
    apiKey: "$CROFAI_API_KEY",

    models,
  };
}

async function registerModels(
  pi: ExtensionAPI,
  apiKey: string,
  ctx?: { ui: { notify: (msg: string, type: string) => void } },
): Promise<void> {
  const models = await fetchCrofModels(apiKey);
  if (models.length === 0) {
    ctx?.ui.notify("No models returned from API. Check your API key.", "error");
    return;
  }
  pi.registerProvider("CrofAI", crofProviderConfig(models));
  ctx?.ui.notify(`CrofAI: ${models.length} models loaded!`, "info");
}

export default async function (pi: ExtensionAPI) {
  // Pre-fetch models if CROFAI_API_KEY env var is set
  const envKey = process.env.CROFAI_API_KEY;
  if (envKey) {
    try {
      await registerModels(pi, envKey);
    } catch {
      // Network error — user can run /login-crofai
    }
  } else {
    // Register with no models — provider exists but invisible until login
    pi.registerProvider("CrofAI", crofProviderConfig([]));
  }

  // ── Commands ────────────────────────────────────────────────────────

  pi.registerCommand("login-crofai", {
    description: "Enter your CrofAI API key and load models",
    handler: async (_args: string, ctx) => {
      const apiKey = await ctx.ui.input("Enter your CrofAI API key:", "sk-crof-...");
      if (!apiKey?.trim()) return;

      try {
        // Store key so API calls use it (authHeader: true sends Authorization)
        ctx.modelRegistry.authStorage.set("CrofAI", {
          type: "api_key" as const,
          key: apiKey.trim(),
        });
        await registerModels(pi, apiKey.trim(), ctx.ui);
      } catch (err) {
        ctx.ui.notify(
          `Failed: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      }
    },
  });

  pi.registerCommand("refresh-crof", {
    description: "Refresh CrofAI models from the API",
    handler: async (_args: string, ctx) => {
      const apiKey = await ctx.modelRegistry.getApiKeyForProvider("CrofAI");
      if (!apiKey) {
        ctx.ui.notify(
          "No API key. Run /login-crofai first.",
          "error",
        );
        return;
      }
      ctx.ui.notify("Refreshing CrofAI models...", "info");
      try {
        await registerModels(pi, apiKey, ctx.ui);
      } catch (err) {
        ctx.ui.notify(
          `Refresh failed: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      }
    },
  });
}
