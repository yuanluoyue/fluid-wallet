# Contributing

Thanks for looking. This project is small enough that the rules can be short.

## Run it

```bash
pnpm install
pnpm build:extension     # → apps/extension/dist/chrome-mv3, load that folder unpacked
pnpm dev:playground      # http://localhost:5174, the protocol console
pnpm dev:website         # http://localhost:3000, the docs site
```

`pnpm dev:extension` builds a _dev-server_ artifact instead: its popup points at
`localhost` and its content scripts are registered over a websocket rather than
declared in the manifest. Load it only while that process runs. See "Getting
started" in the README for the full explanation.

## Before you push

```bash
pnpm lint          # eslint
pnpm typecheck     # tsc across every package and app
pnpm test          # vitest, no browser required
pnpm format:check  # prettier
```

CI runs the first three. `format:check` is not in CI but a PR that fails it will
be asked to run `pnpm format` — one formatting commit, please, not a diff where
style and substance are mixed.

## Changing the protocol

The wire format is the public surface of this project, so it changes in one
direction:

1. `specs/protocol.md` (and `permissions.md` / `streaming.md` / `security.md` when
   the change touches them) — describe the behaviour, including what happens on
   error.
2. `packages/protocol` — types, method table, validators.
3. `packages/sdk` — client and helpers, plus the mock wallet in `src/testing`.
4. `apps/extension` — the dispatcher, which must answer every method.
5. Tests at each step.

Adding a method means adding it to `FluidMethod`, `FLUID_METHOD_CAPABILITIES` and
`FLUID_METHOD_RESULTS`, then implementing it in `dispatch.ts`. The record types are
exhaustive, so a method without all three does not compile.

## What is deliberately not here

These come up as feature requests and the answer is no:

- **Cloud accounts, hosted billing, telemetry.** The wallet is local-first by
  design; an account server would make the key store the least trusted part.
- **Sending the key to the page.** No method returns credential material, and no
  mode relaxes that — not even the dev fallback, which is page-side and separate
  from the wallet.
- **Reading request bodies on the proxy path.** It would enable spending caps and
  token counts, and it would also make the wallet a device that inspects your
  prompts. The structured path is the one that reads, and its users know it.

## Security issues

Please do not open a public issue for a vulnerability. Use a private security
advisory on the repository, or email the maintainer directly. A fix shipped
quietly is worth more than a dramatic disclosure.

## Language

Code, comments and commit messages are English. The wallet UI ships English and
Chinese together; a new UI string means adding it to `src/i18n/messages/en.ts`
**and** `zh.ts`, where the second file is typed as `Messages` — a missing
translation is a compile error, not a fallback to English.

## Commits

Conventional-commit prefixes (`feat:`, `fix:`, `docs:`, `chore:`), one logical
change per commit, and the body explains _why_ this is the right shape. The
history is part of the project; treat it that way.
