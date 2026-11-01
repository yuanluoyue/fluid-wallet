# @fluid-wallet/protocol

The wire contract behind [Fluid Wallet](https://github.com/yuanluoyue/fluid-wallet)
（流钥）: the message shapes, method names, capability names, error codes and
validators for everything a web page and a wallet extension say to each other.

Zero dependencies, no runtime behaviour. Nothing in this package talks to a
wallet — it only describes what a wallet is allowed to answer, so an app, a
wallet and a test double can agree without sharing an implementation.

```bash
npm install @fluid-wallet/protocol
```

Use it directly if you are **writing a wallet**, **building a test double**, or
want the types without the client. If you are an app that just wants inference,
install [`@fluid-wallet/sdk`](https://www.npmjs.com/package/@fluid-wallet/sdk),
which depends on this package.

## What is in it

| Export                                                                          | What it answers                                              |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `FluidRequest`, `FluidResponse`, `FluidEvent`                                   | The three envelopes on the wire                              |
| `FluidWalletInfo`, `FluidWalletStatus`                                          | Ready, locked, or no wallet yet — what a page can act on     |
| `FluidMethod`, `FLUID_METHOD_NAMES`, `isFluidMethodName`                        | Method names, as a value you can iterate or narrow from      |
| `FLUID_METHOD_CAPABILITIES`                                                     | Which capability each method is gated behind                 |
| `FLUID_CAPABILITIES`, `GRANTABLE_CAPABILITIES`, `isGrantableCapability`         | Every capability, and the subset a page may hold             |
| `hasCapability`, `isPermissionExpired`, `modelSupports`, `messageToText`        | The four checks every wallet ends up writing by hand         |
| `FluidError`, `FluidErrorCode`, `isFluidErrorShape`, `toFluidError`             | Errors that survive a `postMessage` boundary                 |
| `parseRequest`, `parseResponse`, `parseEvent`, `parseInferenceParams`, …        | Validators that return `{ ok, value }` / `{ ok, error }`     |
| `FLUID_LIMITS`                                                                  | Size and count ceilings, so both sides reject the same thing |
| `PROTOCOL_VERSION`, `MIN_SUPPORTED_PROTOCOL_VERSION`                            | Handshake versions                                           |
| `FLUID_GLOBAL_NAME`, `FLUID_MESSAGE_CHANNEL`, `isFluidBridge`, `getFluidBridge` | The injected `window.fluid` surface                          |
| `resolveProviderUrl`, `isAllowedProviderEndpoint`, `PROVIDER_ENDPOINTS`         | URL allow-listing for the proxy path                         |

## Capabilities

A page never asks for "the API". It asks for a named capability, and the user
approves that list once per origin.

| Capability           | What it lets the page do                                     |
| -------------------- | ------------------------------------------------------------ |
| `wallet:read`        | Read the wallet's identity and its current grant             |
| `models:list`        | List providers and the models they offer                     |
| `inference:text`     | Send messages, receive a finished result                     |
| `inference:stream`   | Receive deltas while the answer is being written             |
| `inference:tools`    | Send tool definitions and receive tool calls                 |
| `inference:proxy`    | Speak the provider's own HTTP API, for drop-in provider SDKs |
| `conversation:read`  | Read stored conversations                                    |
| `conversation:write` | Append to stored conversations                               |
| `activity:read`      | Read the call log and today's budget                         |
| `wallet:manage`      | Change wallet settings — **never granted to a page**         |
| `provider:manage`    | Add or edit providers — **never granted to a page**          |

`GRANTABLE_CAPABILITIES` is the list a wallet is allowed to hand out. The last
two exist in `FLUID_CAPABILITIES` only so the wallet's own UI can name them.

## Methods

| Method                  | Capability            |
| ----------------------- | --------------------- |
| `wallet.getInfo`        | — (public by design)  |
| `wallet.open`           | — (raises the wallet) |
| `wallet.connect`        | — (its own approval)  |
| `wallet.disconnect`     | —                     |
| `wallet.getPermissions` | `wallet:read`         |
| `wallet.revoke`         | `wallet:read`         |
| `provider.list`         | `models:list`         |
| `model.list`            | `models:list`         |
| `session.create`        | `inference:text`      |
| `session.close`         | `inference:text`      |
| `inference.create`      | `inference:text`      |
| `inference.proxy`       | `inference:proxy`     |
| `inference.cancel`      | — (session ownership) |
| `conversation.list`     | `conversation:read`   |
| `conversation.get`      | `conversation:read`   |
| `conversation.append`   | `conversation:write`  |
| `usage.get`             | `activity:read`       |
| `activity.list`         | `activity:read`       |

## Validating what crossed the boundary

Anything that arrives from another world — an injected script, a `postMessage`
listener, a socket — is `unknown` until it is parsed. The validators exist so a
wallet never has to trust a shape it did not check:

```ts
import { parseResponse, FluidError, FluidErrorCode } from "@fluid-wallet/protocol";

const parsed = parseResponse(await response.json());

if (!parsed.ok) {
  // parsed.error is a FluidError with a wire code, not a thrown string.
  throw parsed.error;
}

const envelope = parsed.value; // typed FluidResponse
```

The same shape covers requests, events, inference params and proxy params. Each
function takes `unknown` and returns `{ ok: true, value }` or
`{ ok: false, error }`; the `assert*` variants throw the error instead.

## Errors

```ts
import { FluidError, FluidErrorCode } from "@fluid-wallet/protocol";

try {
  await wallet.call("inference.create", params);
} catch (error) {
  if (FluidError.is(error) && error.code === FluidErrorCode.PermissionDenied) {
    // the user said no — offer the settings path, do not retry
  }
}
```

| Range    | Meaning                                                                                                                                                   |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-326xx` | JSON-RPC transport faults: invalid request, unknown method, bad params                                                                                    |
| `410x`   | Wallet state: not installed, locked, unauthorized, permission denied, session expired, model not allowed, provider unavailable, origin mismatch, rejected |
| `420x`   | Request outcome: rate limited, budget exceeded, inference failed, cancelled, timeout, payload too large                                                   |

`code` is stable; `message` is for humans and may change between releases.

## Compatibility

`PROTOCOL_VERSION` is the version this package implements,
`MIN_SUPPORTED_PROTOCOL_VERSION` the oldest one it still accepts. A wallet
reports both during `wallet.getInfo`; a page is expected to refuse a wallet
below its minimum rather than call methods that may not exist.

The full specification lives in
[`specs/protocol.md`](https://github.com/yuanluoyue/fluid-wallet/blob/main/specs/protocol.md).

## License

MIT
