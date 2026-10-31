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
}

/**
 * Presets only prefill the form; nothing here is required to add a provider.
 *
 * A preset is deliberately just an identity — a name and an address. It carries
 * no model list and no default model: those are properties of the account and
 * the week, not of the endpoint, and a hardcoded list goes stale the moment the
 * provider ships a model. `GET {baseUrl}/models` is the source of truth, which
 * is why the form has a button for it.
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
  },
  {
    key: "custom",
    name: "Custom OpenAI-compatible endpoint",
    baseUrl: "https://",
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
