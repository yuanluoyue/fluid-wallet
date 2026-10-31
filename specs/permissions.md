# Permissions

A permission is not "this site may use AI". It is a set of specific capabilities,
optionally narrowed to providers and models, with an explicit expiry.

## 1. Capability model

| Capability           | Grants                                        | Grantable to a page     |
| -------------------- | --------------------------------------------- | ----------------------- |
| `wallet:read`        | Read wallet info and the current grant        | yes                     |
| `models:list`        | Enumerate providers and models in scope       | yes                     |
| `inference:text`     | Create sessions and non-streamed inference    | yes                     |
| `inference:stream`   | Receive streaming deltas                      | yes                     |
| `inference:tools`    | Send tool definitions and tool results        | yes                     |
| `inference:proxy`    | Send raw requests to a configured provider    | yes                     |
| `conversation:read`  | Read conversations owned by this origin       | yes                     |
| `conversation:write` | Append messages to its own conversations      | yes                     |
| `activity:read`      | Read call logs for this origin                | yes                     |
| `wallet:manage`      | Change wallet settings                        | **no** — wallet UI only |
| `provider:manage`    | Add, edit or remove credentials and endpoints | **no** — wallet UI only |

`wallet:manage` and `provider:manage` are rejected at grant time with
`PermissionDenied`, not silently dropped.

## 2. Grant shape

```ts
interface FluidPermission {
  origin: string; // resolved from the browser sender, never from the page
  appId?: string;
  providers: string[];
  models?: string[]; // omitted means "any model of the granted providers"
  capabilities: FluidCapability[];
  grantedAt: number;
  expiresAt?: number;
}
```

The wallet stores one grant per origin. Re-approving replaces it, so a site can
narrow or widen its scope but cannot accumulate hidden extra capabilities.

## 3. Flow

1. Page calls `wallet.connect` with the capabilities it wants and a human
   readable `reason`.
2. A wallet with no provider to serve the request refuses with
   `ProviderUnavailable` and `data.reason: "no-provider"`, and says where to add
   one. A grant that reaches nothing would only fail one call later, on a chat
   message with no explanation.
3. The wallet shows the **sender origin**, the app name from its own metadata
   (not from the request when a mismatch is detectable), and the requested scope.
4. On approval the wallet persists the grant and emits `permissions.changed`.
5. On decline it returns `Rejected` and stores nothing.

Default TTL is 7 days. A wallet may shorten it; it must not silently extend it.

## 4. Enforcement

Enforcement happens **only** in the trusted runtime.

```
request → verify sender origin → resolve grant → check method capability
        → check provider/model scope → check rate limit → execute
```

A page that skips the SDK and hand-crafts messages gets exactly the same checks.
Anything enforced in the page is advisory and must never be trusted.

## 5. Revocation

- `wallet.revoke` removes the grant and closes every session for that origin.
- `wallet.disconnect` ends the current connection and closes its sessions.
- Both must take effect before the next request, including in-flight streams:
  an outstanding stream is cancelled and terminated with `InferenceCancelled`.
- Permission expiry is evaluated on read, so a stale grant fails closed even if
  no timer fired while the service worker was suspended.

## 6. Tool permissions

Tool calls are a separate grant surface:

- Declaring tools requires `inference:tools`.
- Executing a tool happens in the app, not the wallet — the wallet only relays
  the call and the result.
- Tools marked `risk: "medium" | "high"` may require a per-call confirmation.
  This is a wallet policy decision, not something the app opts out of.
- Tool results are summarised or referenced, not stored verbatim by default.

## 7. Raw requests

`inference:proxy` is broader than `inference:text` and is never granted by
default, because the wallet cannot inspect what an app sends:

- The approval dialog must show it as its own line, in plain words.
- The grant still narrows by provider, and a JSON body with a `model` field is
  checked against the model allow-list.
- A wallet must refuse page-supplied credentials, and must build the request URL
  itself rather than trusting an absolute URL.
- Because the body is opaque, raw calls cannot be priced or token-counted; a
  wallet that advertises a spending cap must either refuse this capability or
  say that the cap does not cover it.
- The reachable endpoints are a closed list (`POST /chat/completions`,
  `POST /completions`, `POST /embeddings`, `GET /models`). Providers expose far
  more than that on the same host, and "any path on a trusted host" is the API
  equivalent of an unlimited token approval.

## 8. Limits

| Limit                          | Default |
| ------------------------------ | ------- |
| Messages per request           | 256     |
| Characters per message         | 100 000 |
| Tools per request              | 64      |
| Tool name length               | 64      |
| Request payload                | 1 MB    |
| Raw request path length        | 512     |
| Requests per origin per minute | 60      |
| Requests per origin per day    | 300     |

Exceeding a limit yields `PayloadTooLarge`, `RateLimited` or `BudgetExceeded`;
the wallet never truncates silently. The daily counter is configurable and
survives service-worker restarts; `0` disables it.

## 9. Grant lifetime

- A grant lasts a week by default, so an abandoned connection quietly expires.
- "Always allow" means **no expiry** (`expiresAt` omitted), not a longer one.
- Expiry is checked on every read rather than with a timer, because a suspended
  service worker has no timers.
- Grants are local to the wallet that issued them. A backup carries credentials,
  never permissions: restoring on another machine must not re-authorise apps the
  user did not re-approve there.
