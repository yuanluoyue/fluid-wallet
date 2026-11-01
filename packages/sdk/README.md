# @fluid-wallet/sdk

Connect a web app to [Fluid Wallet](https://github.com/yuanluoyue/fluid-wallet)
（流钥）: a browser wallet that holds the user's LLM credentials, so the page can
ask for inference without ever seeing an API key.

The app never reaches a provider. Every call crosses one boundary — sender
origin → permission → session → rate limit → provider — and comes back as text,
a stream, or a `Response` the provider's own SDK already understands.

```bash
npm install @fluid-wallet/sdk
```

The wallet itself is a browser extension. It is not on the Chrome Web Store yet,
so for now you build it and load it unpacked:

```bash
git clone https://github.com/yuanluoyue/fluid-wallet
cd fluid-wallet && pnpm install && pnpm build:extension
# chrome://extensions → Developer mode → Load unpacked → apps/extension/dist/chrome-mv3
```

Without the extension nothing throws: `connectFluid()` reports
`mode: "dev"` when a development key is configured, and a typed
`describeFluidError()` otherwise.

## Two ways in

Pick by how much of the request your app wants to own.

### 1. Keep your provider SDK — `connectFluid()`

One call connects, asks the user for consent, opens a session and hands back a
`fetch`. Pass it to the provider package you already use; nothing else changes,
because the request body is forwarded untouched.

```ts
import { connectFluid } from "@fluid-wallet/sdk";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";

const fluid = await connectFluid({
  appName: "ChemBioTube",
  providerId: "deepseek", // optional: omit to let the user pick
  reason: "Explain the selected sequence.",
});

const deepseek = createOpenAI({
  apiKey: "fluid", // placeholder — the wallet injects the real key
  baseURL: "https://api.deepseek.com/v1",
  fetch: fluid.createFetch(),
});

const result = streamText({ model: deepseek("deepseek-chat"), messages, tools });
```

`fluid.createFetch()` also takes options when you bypass `connectFluid()` and
drive `FluidClient` yourself:

```ts
import { createFluidFetch } from "@fluid-wallet/sdk";

const fluidFetch = createFluidFetch(client, {
  sessionId,
  providerId: "deepseek",
  // How long the stream may be silent before it is treated as dead. The default
  // is 30s; 0 disables the deadline.
  idleTimeoutMs: 30_000,
  // Called once if the wallet has forgotten the session (extension update, idle
  // timeout). Returning a fresh id makes the request retry instead of failing.
  recoverSession: async () => (await client.createSession()).id,
});
```

The page only supplies a **path**. Scheme, host and credentials come from the
provider the user configured, so a compromised page cannot point the wallet
somewhere else. This path needs `inference:proxy`, which `connectFluid()`
requests by default.

Two details decide whether a real provider SDK works through this door:

- **Request headers.** The page may set `content-type`, `accept` and the
  version/organisation headers a provider negotiates with (`anthropic-version`,
  `openai-organization`, …) — the full list is `FLUID_PROXY_REQUEST_HEADERS` on
  `@fluid-wallet/protocol`. Everything else is dropped, including the
  `authorization` header your SDK sends: the credential is the wallet's, and the
  placeholder key never leaves the page.
- **Response headers.** `retry-after` and the `x-ratelimit-*` family come back
  on the `Response`, so a client that knows how to back off from a 429 still
  can. `content-encoding` and `content-length` do not, because the body has been
  re-framed as text and those two would be wrong.

The key is injected as `authorization: Bearer`, which is what OpenAI-compatible
providers expect. A provider that authenticates with a different scheme is not
supported by this path yet.

### 2. Let the wallet shape the request — `FluidClient`

Use the structured API when the wallet should own the request shape and the app
should stay provider-agnostic:

```ts
import { FluidClient } from "@fluid-wallet/sdk";

const client = new FluidClient({ appName: "My app" });

await client.connect({
  capabilities: ["wallet:read", "models:list", "inference:text", "inference:stream"],
  reason: "Answer questions about the current document.",
});

const session = await client.createSession({ model: "deepseek-chat" });

const inference = client.createInference({
  sessionId: session.id,
  messages: [{ role: "user", content: "Summarise this page." }],
  stream: true,
});

for await (const event of inference.events) {
  if (event.type === "inference.delta") {
    process.stdout.write((event.payload as { text: string }).text);
  }
}

const final = await inference.completed; // usage, finish reason, model
```

`createInference()` returns immediately with a handle: `events` is the stream,
`completed` resolves once, `cancel()` stops it. The request id is generated
_before_ the request goes out, so no early delta is missed.

`client.state` keeps availability, connection, authorization, session and
per-request inference state apart on purpose — collapsing them into one
`isConnected` boolean is how an app ends up showing "connected" while every call
fails.

| Method                                                               | Purpose                                      |
| -------------------------------------------------------------------- | -------------------------------------------- |
| `detect()` / `detectAttempts`                                        | Is a wallet there at all, and what happened  |
| `connect()` / `disconnect()` / `revoke()`                            | The permission lifecycle                     |
| `getPermissions()`                                                   | What this origin may do right now            |
| `listProviders()` / `listModels(id?)`                                | What is configured, without a session        |
| `createSession()` / `closeSession(id?)`                              | Sessions bound to a grant                    |
| `createInference()` / `cancelInference()`                            | The structured path                          |
| `usage()`                                                            | Today's request budget, or `null`            |
| `listConversations()` / `getConversation()` / `appendConversation()` | Stored history                               |
| `subscribe()` / `onEvent()`                                          | State snapshots and raw protocol events      |
| `call(method, params)`                                               | Typed escape hatch for anything unwrapped    |
| `dispose()`                                                          | Release the pipes; a disposed client is dead |

## React

```tsx
import { FluidProvider, useFluidWallet, useFluidModels } from "@fluid-wallet/sdk/react";

export function App() {
  return (
    <FluidProvider appName="My app">
      <Chat />
    </FluidProvider>
  );
}

function Chat() {
  const { availability, connection, authorization } = useFluidWallet();
  const { models, loading, refresh } = useFluidModels();

  if (availability === "unavailable") return <InstallPrompt />;
  if (authorization !== "granted") return <ConnectButton />;
  // connection === "connected" here
}
```

`useFluidWallet()` subscribes to the subset most UIs need, so a streaming answer
does not re-render the button that says "connected". `useFluidState()` is the
full snapshot; `useFluidClient()` hands you the client itself.

## Vercel AI SDK

`@fluid-wallet/sdk/ai` is a transport, not a fork: `useChat()` keeps working and
the wallet becomes the model provider.

```tsx
import { useChat } from "@ai-sdk/react";
import { createFluidChatTransport } from "@fluid-wallet/sdk/ai";

const transport = createFluidChatTransport({ client, model: "deepseek-chat" });
const { messages } = useChat({ transport });
```

`ai` is an optional peer dependency; install it only if you use this subpath, and
the same goes for `react`.

## Testing without a browser

`@fluid-wallet/sdk/testing` ships an in-memory wallet that speaks the protocol,
including `inference.proxy`, so the same code paths run in vitest with no
extension installed:

```ts
import { createMockWallet } from "@fluid-wallet/sdk/testing";
import { FluidClient, BridgeTransport, connectFluid } from "@fluid-wallet/sdk";

const wallet = createMockWallet({ permissionMode: "auto" });
const client = new FluidClient({ transport: new BridgeTransport(wallet) });
const fluid = await connectFluid({ client });
```

`permissionMode` can be `"auto"`, `"deny"` or `"expired"` — the three states
every app gets wrong first. It is also the conformance target for third-party
wallet implementations.

## Errors worth handling

```ts
import { describeFluidError, needsUserAction } from "@fluid-wallet/sdk";

try {
  await fluid.createFetch()("https://api.deepseek.com/v1/chat/completions", init);
} catch (error) {
  const issue = describeFluidError(error);
  // issue.kind:   "unavailable" | "locked" | "not-connected" | "denied" | …
  // issue.action: "install" | "unlock" | "connect" | "approve" | "wait" | …
  if (needsUserAction(error)) showBanner(issue.title, issue.detail);
}
```

`describeFluidError()` returns a line that is safe to show as-is, plus an
`action` for what the user has to do next and — for an unreachable wallet — an
`evidence` string with the bridge counters behind it. Raw codes stay on
`@fluid-wallet/protocol` if you need to branch on them yourself.

## Default capabilities

`connectFluid()` asks for `wallet:read`, `models:list`, `inference:text`,
`inference:stream` and `inference:proxy`. `FluidClient.connect()` asks for the
first four. The user sees the list in the approval panel and can refuse; a
request outside the grant fails with `PermissionDenied` rather than silently
degrading.

`inference:proxy` is broader than `inference:text` — it lets the page speak the
provider's raw HTTP API — so it is never granted implicitly by the wallet.

## Development fallback

When no wallet answers and a key is present in the environment,
`connectFluid()` calls the provider directly so local work does not need the
extension:

```bash
# Next.js / Node: FLUID_DEV_API_KEY
# Vite: the VITE_ prefix is what its env replacement exposes
FLUID_DEV_API_KEY=sk-...
VITE_FLUID_DEV_API_KEY=sk-...
```

`fluid.mode` is then `"dev"` instead of `"wallet"`. A production build refuses
this path outright: it is a convenience, never a security boundary.

Both lookups are static property reads, which is the only form a bundler can
replace. A dynamic `process.env[name]` in a browser bundle is `undefined` — and
an `isProduction()` built on it is never true, so the guard silently stops
guarding.

## Scope for 0.1.x

Text in, text out, with streaming and cancellation. Tool calls are surfaced to
the UI but cannot be carried back into the next request yet: the wallet's
provider layer has no way to express a tool result, so a multi-step agent has to
own that loop itself for now. Images, structured output and stream resumption
are not promised either.

The proxy path is passthrough by design, so whatever provider feature you use
there already works — as long as the provider authenticates with a bearer token.

## License

MIT
