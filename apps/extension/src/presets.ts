/**
 * Provider presets and the shape of an edit from the UI.
 *
 * Kept free of runtime dependencies so the options page can import it without
 * pulling Dexie or the vault into its bundle.
 */

export interface ProviderPreset {
  key: string;
  name: string;
  baseUrl: string;
  models: string[];
  defaultModel: string;
}

/**
 * Presets only prefill the form; nothing here is required to add a provider.
 *
 * v0.1 ships DeepSeek plus a generic OpenAI-compatible entry on purpose. Every
 * extra "supported provider" is an API surface we would have to keep honest,
 * and the raw proxy path already covers anything that speaks the same protocol.
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    key: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
    defaultModel: "deepseek-chat",
  },
  {
    key: "custom",
    name: "Custom OpenAI-compatible endpoint",
    baseUrl: "https://",
    models: [],
    defaultModel: "",
  },
];

export interface ProviderInput {
  id?: string;
  name: string;
  baseUrl: string;
  models: string[];
  defaultModel?: string;
  /** Only sent when the user changes the key; leaving it out keeps the old one. */
  apiKey?: string;
}
