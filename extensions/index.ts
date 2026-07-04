import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";

const CACHE_PATH = join(homedir(), ".pi", "crofai-models.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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

interface ModelCache {
  fetchedAt: number;
  models: ProviderModelConfig[];
}

async function readCache(): Promise<ModelCache | undefined> {
  try {
    const cache = JSON.parse(await readFile(CACHE_PATH, "utf8")) as ModelCache;
    return Array.isArray(cache.models) && typeof cache.fetchedAt === "number"
      ? cache
      : undefined;
  } catch {
    return undefined;
  }
}

async function writeCache(models: ProviderModelConfig[]): Promise<void> {
  await mkdir(dirname(CACHE_PATH), { recursive: true });
  await writeFile(CACHE_PATH, JSON.stringify({ fetchedAt: Date.now(), models }, null, 2));
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
  notify?: (msg: string, type: string) => void,
): Promise<void> {
  const models = await fetchCrofModels(apiKey);
  if (models.length === 0) {
    notify?.("No models returned from API. Check your API key.", "error");
    return;
  }
  pi.registerProvider("CrofAI", crofProviderConfig(models));
  await writeCache(models);
  notify?.(`CrofAI: ${models.length} models loaded!`, "info");
}

async function loginCrofai(pi: ExtensionAPI, ctx: ExtensionCommandContext) {
  const apiKey = await ctx.ui.input("Enter your CrofAI API key:", "sk-crof-...");
  if (!apiKey?.trim()) return;

  try {
    ctx.modelRegistry.authStorage.set("CrofAI", {
      type: "api_key" as const,
      key: apiKey.trim(),
    });
    await registerModels(pi, apiKey.trim(), ctx.ui.notify);
  } catch (err) {
    ctx.ui.notify(
      `Failed: ${err instanceof Error ? err.message : String(err)}`,
      "error",
    );
  }
}

export default async function (pi: ExtensionAPI) {
  const cache = await readCache();
  pi.registerProvider("CrofAI", crofProviderConfig(cache?.models ?? []));

  const shouldRefresh = !cache || Date.now() - cache.fetchedAt > CACHE_TTL_MS;
  const envKey = process.env.CROFAI_API_KEY;
  if (envKey && shouldRefresh) {
    try {
      await registerModels(pi, envKey);
    } catch {
      // Network error — keep cached models
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    const cache = await readCache();
    if (cache && Date.now() - cache.fetchedAt <= CACHE_TTL_MS) return;

    const apiKey = await ctx.modelRegistry.getApiKeyForProvider("CrofAI");
    if (!apiKey) return;

    try {
      await registerModels(pi, apiKey);
    } catch {
      // Network error — keep cached models
    }
  });

  // ── Commands ────────────────────────────────────────────────────────

  pi.registerCommand("login-crofai", {
    description: "Enter your CrofAI API key and load models",
    handler: async (_args: string, ctx) => loginCrofai(pi, ctx),
  });

  pi.registerCommand("login-crof-ai", {
    description: "Alias for /login-crofai",
    handler: async (_args: string, ctx) => loginCrofai(pi, ctx),
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
        await registerModels(pi, apiKey, ctx.ui.notify);
      } catch (err) {
        ctx.ui.notify(
          `Refresh failed: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      }
    },
  });
}
