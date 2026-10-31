# Fluid Wallet

**Open, local-first LLM wallet and access protocol for web AI applications.**

Users already have a DeepSeek (or any OpenAI-compatible) API key. Every pure
front-end AI app asks them to paste it in again, keep it in `localStorage`, and
manage model settings separately. Fluid Wallet moves that concern into one place:
a browser wallet that owns the credentials, and a protocol that lets any app ask
for inference without ever touching them.

> Status: **MVP-03**. The wallet works end to end: encrypted vault, provider
> management with connection tests and a fetched model catalogue, connect
> approval, scoped permissions, streamed inference, cancellation, an activity
> log, and a raw proxy path so apps can keep using their provider's own SDK. A
> connect request against a wallet with no provider is refused with a window
> that leads straight to the provider form. The panel itself is bilingual
> (English / 中文, switchable in the header). Store packaging and tool-call
> round trips are next.

## Principles

- **User-owned credentials** — keys live in the wallet, encrypted at rest.
- **Connect once** — a scoped grant covers every app on that origin.
- **Local-first** — no account server, no cloud relay, no telemetry.
- **Open protocol** — versioned and documented, so a third party can ship a
  compatible wallet.
- **Bring your own tools** — tool definitions and execution stay in the app.

## Architecture

```
AI applications   ChembioTube · GeneFlow · third-party web apps
                  UI · business state · tools · app context
        │
Fluid SDK         connect · permissions · sessions · chat · stream · tool bridge
        │
Fluid Wallet      extension: vault · model routing · conversations · call logs
        │
LLM providers     DeepSeek · OpenAI-compatible endpoints · others later
```

The page never reaches provider APIs. Every call crosses one verified boundary:
sender origin → permission → session → rate limit → provider.

## Layout

```
apps/
  extension/      WXT (MV3) + React wallet: page bridge, service worker, popup
  website/        Next.js site: product, docs, quick start
  playground/     Protocol console: detect, connect, stream
packages/
  protocol/       Wire types, methods, error codes, validators   (published, zero deps)
  sdk/            Client, connectFluid, createFetch, errors      (published)
    src/react/    Provider and hooks          → /react
    src/ai/       Vercel AI SDK transport     → /ai
    src/testing/  In-memory mock wallet       → /testing
  core/           Wallet kernel, only the extension imports it   (private)
    src/crypto/     PBKDF2 + AES-GCM key vault
    src/providers/  OpenAI-compatible adapter, DeepSeek preset
    src/runtime/    Origin checks, permissions, sessions, limits
    src/storage/    Dexie/IndexedDB schema
examples/
  vanilla-js/     Plain TypeScript integration, no framework
specs/
  protocol.md · permissions.md · streaming.md · security.md
```

Three packages, one install: apps add `@fluid-wallet/sdk`; a future wallet
implementation needs only `@fluid-wallet/protocol`. `core` is never published —
it assumes IndexedDB, Web Crypto and a service worker, and it encodes our
choices rather than an interface worth promising to anyone else.

## Getting started

```bash
pnpm install
pnpm build        # compile workspace packages
pnpm typecheck
pnpm test
```

Then, in separate terminals:

```bash
pnpm dev:extension     # prints apps/extension/dist/chrome-mv3-dev; load it as unpacked
pnpm dev:playground    # http://localhost:5174
pnpm dev:website       # http://localhost:3000
```

The extension build is not launched for you on purpose: Chrome has no way to
watch a folder, so `Load unpacked` → `apps/extension/dist/chrome-mv3-dev` is a
one-time step, and ⟳ on the card reloads it after a rebuild. (`dist/`, not
WXT's default `.output/`, because the picker hides dot-folders.)

## Deploying the website

`apps/website` deploys to Cloudflare Workers through OpenNext, the same setup as
ChembioTube: `next build --webpack` → `opennextjs-cloudflare build` → `wrangler
deploy`. The site is fully prerendered, so Workers Cache serves hits without
executing the Worker at all, and cache interception keeps a cold miss under the
free plan's CPU ceiling.

```bash
pnpm --filter @fluid-wallet/website deploy    # builds and deploys

# local edge preview (workerd, real bindings)
pnpm --filter @fluid-wallet/website preview
```

First deploy needs `wrangler login` (or `CLOUDFLARE_API_TOKEN`). The Worker name
is `fluid-wallet-website`; add a custom domain in `wrangler.jsonc` when DNS is
ready. There is no D1 binding — the wallet keeps everything in the browser, and
the site needs no database.

## Using the SDK

There are two ways in. Pick by how much of the request the app wants to own.

### 1. Keep your provider SDK (recommended for existing apps)

`connectFluid()` connects, asks for consent, opens a session and returns a
`fetch`. Hand that to the provider SDK you already use and nothing else changes —
streaming, tools and JSON mode all work because the request is passed through
untouched.

```ts
import { connectFluid } from "@fluid-wallet/sdk";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";

const fluid = await connectFluid({
  appName: "ChemBioTube",
  providerId: "deepseek",
  reason: "Explain the selected sequence.",
});

// Any provider package that accepts a `fetch` option works: @ai-sdk/deepseek,
// @ai-sdk/openai, or the official `openai` client.
const deepseek = createOpenAI({
  apiKey: "fluid",                                  // placeholder: the wallet injects the real key
  baseURL: "https://api.deepseek.com/v1",
  fetch: fluid.createFetch(),
});

const result = streamText({ model: deepseek("deepseek-chat"), messages, tools });
```

The app only supplies a *path*. The scheme, host and key come from the provider
the user configured, so a compromised page cannot point the wallet anywhere else.
This path needs the `inference:proxy` capability, which `connectFluid` requests
and the approval window spells out.

### 2. Let the wallet shape the request

Use the structured API when the app wants the wallet to record the conversation
and keep provider details out of the client entirely:

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
  if (event.type === "inference.delta") process.stdout.write((event.payload as { text: string }).text);
}
```

`FluidClient.state` keeps `availability`, `connection`, `authorization`,
`session` and per-request `inference` state apart on purpose — a single
`isConnected` flag hides exactly the failures users hit in practice.

### Working without the extension

`connectFluid()` falls back to calling DeepSeek directly when no wallet answers,
but only if a development key is present:

```bash
# .env.local — Vite needs the VITE_ prefix, Next.js does not
FLUID_DEV_API_KEY=sk-...
```

```ts
const fluid = await connectFluid({ appName: "My app" });
// mode === "wallet" with the extension, "dev" without it
```

Nothing else in the app changes: `fluid.createFetch()` resolves URLs with the
same helper the wallet uses. The fallback refuses to run in a production build,
and it is a convenience, never a security boundary.

## Testing without a browser

`@fluid-wallet/sdk/testing` ships an in-memory wallet that speaks the protocol,
including `inference.proxy`:

```ts
import { createMockWallet } from "@fluid-wallet/sdk/testing";
import { FluidClient, BridgeTransport, connectFluid } from "@fluid-wallet/sdk";

const wallet = createMockWallet({ permissionMode: "auto" });
const client = new FluidClient({ transport: new BridgeTransport(wallet) });
const fluid = await connectFluid({ client });
```

This is also the conformance target for third-party wallet implementations.

## Roadmap

| Milestone | Scope                                                                 | State |
| --------- | --------------------------------------------------------------------- | ----- |
| MVP-01    | Monorepo, protocol, SDK, mock wallet, conformance tests                | done  |
| MVP-02    | Encrypted vault, provider config, approval dialog, streamed inference  | done  |
| MVP-03    | Conversations, activity log, AI SDK adapter, React hooks               | done  |
| MVP-04    | Tool-call round trips, Firefox packaging, store release, docs site      | next  |

Known gaps, stated plainly:

- **Tool calls** are streamed to the app and persisted, but the wallet does not
  yet wait for a tool result and continue the turn — the app drives that loop.
- **Raw proxy requests are opaque.** The wallet sees a path, a status and a byte
  count, never the body. That is the privacy trade-off that makes drop-in SDK
  compatibility possible, and it also means the structured path is the only one
  with conversation history and per-request token accounting.
- **Approval resilience**: if Chrome kills the service worker while the approval
  window is open, the pending `wallet.connect` fails; the page must retry.
- **Provider breadth**: DeepSeek plus any OpenAI-compatible endpoint. Adding one
  is a form, and the wallet can test it and pull its `/models` catalogue, but
  there is no OAuth or subscription-token flow. Deliberate: every advertised
  provider is an API surface to keep honest.
- **Wallet UI translations**: English and Chinese ship together. The UI is
  localized; error text thrown by the service worker is not, and a third
  language means adding one file next to `zh.ts` — typed as `Messages`, so it
  cannot half-exist.
- **Budgets**: rate limiting is per origin, but there is no per-app spending cap,
  and a raw request cannot be priced without reading it.

Explicitly out of scope for now: hosted billing, cloud accounts, team
permissions, an app directory, and full Vercel AI SDK feature parity.

## Security

Read [`specs/security.md`](specs/security.md) before contributing. The short
version: no method returns credential material, origins come from the browser
sender, decryption happens only in the trusted context, and logs never contain
prompts, responses or keys.

## License

MIT
