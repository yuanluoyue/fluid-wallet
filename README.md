# Fluid Wallet

**Open, local-first LLM wallet and access protocol for web AI applications.**

Users already have a DeepSeek (or any OpenAI-compatible) API key. Every pure
front-end AI app asks them to paste it in again, keep it in `localStorage`, and
manage model settings separately. Fluid Wallet moves that concern into one place:
a browser wallet that owns the credentials, and a protocol that lets any app ask
for inference without ever touching them.

> Status: **MVP-01 scaffold**. The protocol, the SDK, the mock wallet and the
> extension skeleton exist and are tested. Vault unlock, DeepSeek routing and the
> permission dialog land in MVP-02.

## Principles

- **User-owned credentials** — keys live in the wallet, encrypted at rest.
- **Connect once** — a scoped grant covers every app on that origin.
- **Local-first** — no account server, no proxy, no telemetry.
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
  protocol/       Wire types, methods, error codes, validators   (published)
  sdk/            Client: connection, sessions, streaming        (published)
  ai-sdk/         Vercel AI SDK transport adapter                (published)
  react/          Provider and hooks                             (published)
  runtime/        Origin checks, permissions, sessions, limits   (internal)
  storage/        Dexie/IndexedDB schema                         (internal)
  crypto/         PBKDF2 + AES-GCM key vault                     (internal)
  providers/      OpenAI-compatible adapter, DeepSeek preset     (internal)
  test-kit/       In-memory mock wallet                          (internal)
examples/
  vanilla-js/     Plain TypeScript integration, no framework
specs/
  protocol.md · permissions.md · streaming.md · security.md
```

## Getting started

```bash
pnpm install
pnpm build        # compile workspace packages
pnpm typecheck
pnpm test
```

Then, in separate terminals:

```bash
pnpm dev:extension     # load apps/extension/.output/chrome-mv3 as unpacked
pnpm dev:playground    # http://localhost:5174
pnpm dev:website       # http://localhost:3000
```

## Using the SDK

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

## Testing without a browser

`@fluid-wallet/test-kit` ships an in-memory wallet that speaks the protocol:

```ts
import { createMockWallet } from "@fluid-wallet/test-kit";
import { FluidClient, BridgeTransport } from "@fluid-wallet/sdk";

const wallet = createMockWallet({ permissionMode: "auto" });
const client = new FluidClient({ transport: new BridgeTransport(wallet) });
```

This is also the conformance target for third-party wallet implementations.

## Roadmap

| Milestone | Scope                                                                 | State |
| --------- | --------------------------------------------------------------------- | ----- |
| MVP-01    | Monorepo, protocol, SDK, mock wallet, conformance tests                | done  |
| MVP-02    | Vault unlock, DeepSeek config, permission dialog, streamed chat        | next  |
| MVP-03    | Conversations, call logs, AI SDK adapter, React hooks                  | —     |
| MVP-04    | Custom tools, docs site, vanilla + React examples                      | —     |

Explicitly out of scope for now: hosted billing, cloud accounts, team
permissions, an app directory, and full Vercel AI SDK feature parity.

## Security

Read [`specs/security.md`](specs/security.md) before contributing. The short
version: no method returns credential material, origins come from the browser
sender, decryption happens only in the trusted context, and logs never contain
prompts, responses or keys.

## License

MIT
