/**
 * English messages — the source of truth for both the keys and the shape.
 *
 * `zh.ts` is typed as `Messages`, so adding a key here without translating it,
 * or translating a key that does not exist, is a compile error rather than a
 * string that silently falls back at runtime. Same reasoning as mossgap's
 * `src/messages/en.json`, minus the JSON: next-intl needs a JSON file, this
 * build does not, and TypeScript checks a literal object and not a JSON module.
 */
export const en = {
  App: {
    loading: "Loading wallet…",
    loadFailed: "Could not read the wallet state.",
    lock: "Lock",
    tabs: {
      providers: "Providers",
      connections: "Connections",
      activity: "Activity",
      settings: "Settings",
    },
  },

  Common: {
    cancel: "Cancel",
    close: "Close",
    save: "Save",
    edit: "Edit",
    remove: "Remove",
    test: "Test",
    default: "default",
    noAccess: "no access",
    grantAccess: "Grant access",
    language: "Language",
  },

  Onboarding: {
    title: "Create your wallet",
    body: "Your API keys are encrypted on this device with a key derived from this password. It never leaves the browser and is never sent anywhere.",
    password: "Master password",
    passwordHint: "At least 8 characters.",
    confirm: "Confirm password",
    mismatch: "The two passwords do not match.",
    submit: "Create wallet",
    submitting: "Creating…",
    noRecovery:
      "There is no recovery: forgetting this password means re-entering your API keys, not losing your accounts.",
    failed: "Could not create the wallet.",
  },

  Unlock: {
    title: "Locked",
    body: "Enter your master password to unlock model access for connected apps.",
    password: "Master password",
    wrongPassword: "Incorrect password.",
    submit: "Unlock",
    submitting: "Unlocking…",
    failed: "Could not unlock the wallet.",
  },

  Providers: {
    title: "Model providers",
    description:
      "Credentials are encrypted with your master password and stay on this device.",
    empty: "No provider yet. Add your DeepSeek key to get started.",
    noModels: "no models",
    savedAt: "saved {when}",
    add: "Add provider",
    addTitle: "Add provider",
    editTitle: "Edit provider",
    preset: "Preset",
    name: "Name",
    baseUrl: "Base URL",
    baseUrlHint: "OpenAI-compatible root, without /chat/completions.",
    models: "Models",
    modelsHint: "Comma separated. Fetch the list from the provider, or type it by hand.",
    defaultModel: "Default model",
    apiKey: "API key",
    apiKeyKeep: "Leave empty to keep the current key.",
    apiKeyNew: "Stored encrypted.",
    save: "Save provider",
    saving: "Saving…",
    saved: "Provider saved.",
    saveFailed: "Could not save the provider.",
    loadFailed: "Could not load providers.",
    deleteFailed: "Could not delete the provider.",
    defaultFailed: "Could not change the default provider.",
    makeDefault: "Make default",
    test: "Test connection",
    testing: "Testing…",
    testOk: "Connected. {model} answered in {ms} ms.",
    testFailed: "The provider did not answer.",
    fetch: "Fetch models",
    fetching: "Fetching…",
    fetched: "Fetched {count, plural, =0 {no models} one {# model} other {# models}} from {host} in {ms} ms.",
    fetchEmpty: "{host} answered, but listed no models.",
    fetchFailed: "Could not read the model list from {host}.",
    fetchNeedsAccess: "The wallet has no access to {host} yet. Grant it first.",
    fetchNeedsKey: "Enter an API key, or save the provider first.",
    reasonInvalidUrl: "That is not an https base URL.",
    reasonUnauthorized: "The provider rejected this key.",
    reasonNotFound: "The provider answered 404 — check the base URL.",
    reasonTimeout: "The provider did not answer within 20 seconds.",
    reasonNetwork: "Could not reach the provider. Check the network and the base URL.",
    reasonHttp: "The provider answered {status}.",
    reasonNoModel: "There is no model to test with. Add one below, or fetch the list.",
    addAll: "Add all",
    grantHint: "The wallet needs host access before it can reach this provider.",
  },

  Connections: {
    title: "Connected apps",
    description:
      "Each origin gets its own grant. Revoking closes its sessions immediately.",
    empty: "No app has connected to this wallet yet.",
    revoke: "Revoke",
    revokeAll: "Revoke all {count}",
    revokeAllTitle: "Revoke every connected app?",
    revokeAllBody:
      "{count, plural, one {This app} other {All # apps}} will have to ask again before using your models. Nothing else is deleted.",
    revokeAllConfirm: "Yes, revoke all {count}",
    keep: "Keep them",
    granted: "Granted {when}",
    expires: "expires {when}",
    allProviders: "all providers",
    today: "{used} / {limit} requests today",
    todayNoLimit: "{used} requests today · no daily limit",
    loadFailed: "Could not load connections.",
    revokeFailed: "Could not revoke the connection.",
    revokeAllFailed: "Could not revoke the connections.",
  },

  Activity: {
    title: "Activity",
    description: "One row per model call. Prompts and answers are not logged here.",
    empty: "No model calls yet.",
    when: "When",
    app: "App",
    model: "Model",
    status: "Status",
    time: "Time",
    tokens: "Tokens",
    loadFailed: "Could not load activity.",
    statuses: {
      success: "success",
      error: "error",
      cancelled: "cancelled",
      timeout: "timeout",
    },
  },

  Settings: {
    language: {
      title: "Language",
      description: "Changes the wallet itself. Apps that connect to it are unaffected.",
    },
    autoLock: {
      title: "Auto-lock",
      description: "The wallet locks itself after a period without use.",
      label: "Lock after",
      min5: "5 minutes",
      min15: "15 minutes",
      hour1: "1 hour",
      never: "Never (not recommended)",
      now: "Lock now",
      failed: "Could not update the auto-lock.",
    },
    budget: {
      title: "Daily request budget",
      description:
        "Counted per site, per day. Requests over the limit are refused before the provider is called, so a retry loop cannot drain your credit overnight.",
      label: "Requests per site per day",
      hint: "0 means unlimited. Applies to every connected app.",
      failed: "Could not update the daily limit.",
    },
    password: {
      title: "Master password",
      description:
        "Changing it rewraps the encryption key; stored API keys are not re-entered.",
      current: "Current password",
      next: "New password",
      nextHint: "At least 8 characters.",
      submit: "Change password",
      ok: "Password changed. Existing keys stay encrypted with the new one.",
      failed: "Could not change the password.",
    },
    backup: {
      title: "Encrypted backup",
      description:
        "One file with your provider keys, sealed with its own passphrase. Connected apps, grants and logs stay behind on purpose.",
      passphrase: "Backup passphrase",
      passphraseHint:
        "At least 8 characters. Not your master password, and not stored anywhere — losing it loses the backup.",
      export: "Export backup",
      restore: "Restore from a file",
      exported:
        "{count, plural, =0 {No credential} one {# credential} other {# credentials}} saved to {file}. Keep the passphrase separate from the file.",
      exportFailed: "Could not write the backup.",
      restoreHint:
        "Restoring merges by provider id and needs the passphrase the file was exported with, so it opens in a window of its own: a file picker takes focus and the toolbar panel does not survive that.",
    },
  },

  Approval: {
    badge: "Connection request",
    firstTime: "First time this site connects",
    again: "Already connected · asking for wider access",
    nameMismatch:
      "This page names a domain it does not own — check the address bar before approving",
    askingFor: "It is asking for",
    neverSeesKey: "It never receives your API key — only answers. You can revoke this at any time.",
    willUse: "It will use",
    defaultModel: "default model {model}",
    billed:
      "Requests are billed to your own account with that provider, and counted against the per-site daily budget in Settings.",
    directAccess: "Direct API access",
    directAccessBody:
      "This site can call your provider's chat, embedding and model-list endpoints itself, with its own prompt format. Other endpoints — account, balance, files — stay blocked by the wallet.",
    allow7: "Allow for 7 days",
    allowAlways: "Always allow",
    deny: "Deny",
    expiredTitle: "Request expired",
    expiredBody: "The connection request is no longer pending. Ask the app to connect again.",
    loading: "Loading request…",
    loadFailed: "Could not read the request.",
    decideFailed: "Could not send the decision.",
  },

  Setup: {
    badge: "Connection paused",
    title: "Add a provider first",
    body: "This site asked to connect, but the wallet has no model provider to send its requests to. Add your DeepSeek key — or any OpenAI-compatible endpoint — then connect again from the site.",
    origin: "Requested by",
    add: "Add a provider",
    later: "Not now",
    unknownTitle: "Unknown request",
    unknownBody: "The site that asked to connect is missing or malformed.",
  },

  Grant: {
    badge: "Provider access",
    title: "Allow this site?",
    body: "Fluid Wallet calls this address on your behalf, using the key stored in the wallet. The browser asks once per host and remembers the answer.",
    unknownTitle: "Unknown site",
    unknownBody: "The origin to allow is missing or malformed.",
    granted: "Access granted.",
    grantedButton: "Granted",
    denied: "Not granted. The provider stays saved, but calls to it will fail.",
    allow: "Allow access",
    waiting: "Waiting for the browser…",
    failed: "The browser refused the request.",
  },

  Import: {
    title: "Restore a backup",
    body: "Merges by provider id: providers already in this wallet with the same id are overwritten, nothing is deleted.",
    file: "Backup file",
    passphrase: "Backup passphrase",
    passphraseHint: "The passphrase the file was exported with — not your master password.",
    submit: "Restore",
    submitting: "Restoring…",
    done: "Restored: {imported} new, {updated} updated, {skipped} skipped. Connected apps are not restored — re-connect them.",
    failed: "Could not read the backup.",
  },

  Time: {
    justNow: "just now",
    minutesAgo: "{count}m ago",
    hoursAgo: "{count}h ago",
  },

  Capabilities: {
    "wallet:read": "Read wallet status",
    "models:list": "See available models",
    "inference:text": "Send prompts to your models",
    "inference:stream": "Stream responses",
    "inference:tools": "Call tools it defines",
    "inference:proxy": "Use the provider's own API directly",
    "conversation:read": "Read its own conversation history",
    "conversation:write": "Save conversation history",
    "activity:read": "Read its own usage log",
  },
};

/** Every translation file must match this shape exactly. */
export type Messages = typeof en;
