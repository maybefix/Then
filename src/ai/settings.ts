import type { AiMode, AiProvider } from "./types";

/** What the AI pane starts new conversations with. Keys are not here: they live in the Credential Manager. */
export type AiSettings = {
  /** null: the first provider that is ready. */
  provider: AiProvider | null;
  /** Model per provider; a missing entry means the first recommended one. */
  models: Partial<Record<AiProvider, string>>;
  defaultMode: AiMode;
  /** Base address of a local OpenAI-compatible server, e.g. http://localhost:11434 */
  localEndpoint: string;
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: null,
  models: {},
  defaultMode: "consult",
  localEndpoint: "http://localhost:11434",
};

const PROVIDERS: readonly AiProvider[] = ["gemini", "openAi", "claude", "local", "fixture"];

const isProvider = (value: unknown): value is AiProvider => PROVIDERS.includes(value as AiProvider);

/** Model ids are short tokens; anything else in saved settings is dropped. */
const isModelId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 120 && /^[\w.:\-/]+$/.test(value);

export function normalizeAiSettings(value: unknown): AiSettings {
  const source = (value && typeof value === "object" ? value : {}) as Partial<Record<keyof AiSettings, unknown>>;
  const models: AiSettings["models"] = {};
  if (source.models && typeof source.models === "object") {
    for (const [provider, model] of Object.entries(source.models as Record<string, unknown>)) {
      if (isProvider(provider) && isModelId(model)) models[provider] = model;
    }
  }
  return {
    provider: isProvider(source.provider) ? source.provider : null,
    models,
    defaultMode: source.defaultMode === "webResearch" ? "webResearch" : "consult",
    localEndpoint:
      typeof source.localEndpoint === "string" && source.localEndpoint.length <= 200
        ? source.localEndpoint
        : DEFAULT_AI_SETTINGS.localEndpoint,
  };
}

/** Broadcast when a key is saved or deleted, so the pane re-reads which providers are ready. */
export const AI_PROVIDERS_CHANGED = "then-ai-providers-changed";
