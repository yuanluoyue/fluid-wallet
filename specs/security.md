# Security

Fluid Wallet holds API keys that cost the user real money. The security model is
written down before the implementation, because retrofitting it is how wallets
leak keys.

## 1. Threat model

In scope:

| Threat                                        | Mitigation                                        |
| --------------------------------------------- | ------------------------------------------------- |
| Malicious page reads another site's history   | Origin-bound sessions and grants, enforced in the runtime |
| Malicious page forges its origin              | Origin taken from the browser sender, never the payload |
| Key extraction from extension storage at rest | AES-GCM with a PBKDF2-derived key, salt + IV per record |
| Key leaking into logs, errors or exports      | No secret in logs/errors; exports strip credentials |
| Unbounded spend by a page                     | Per-origin rate limits and optional budget caps    |
| Replay after revoke                           | Revocation closes sessions before the next request |

Out of scope for `0.1.0`:

- Malware running with the user's OS privileges (it can read memory and
  keystrokes).
- A user voluntarily pasting their key into a phishing site.
- Compromised provider endpoints.

## 2. Key isolation

- The page never receives, requests or infers a key. There is no method that
  returns credential material, and adding one is a protocol break.
- Decryption happens only in the trusted context (service worker or extension
  page). The key vault inside `@fluid-wallet/core` is never imported by page
  code.
- The derived key is non-extractable and lives in memory only. Locking drops the
  reference; unlocking re-derives from the password.
- The unlock password is never stored — not in `chrome.storage`, not in
  IndexedDB, not in memory beyond the derivation call.

### 2.1 Data-key indirection

Stored credentials are **not** encrypted with the password-derived key directly.
The layout is:

```
password ──PBKDF2(210k, salt)──► KEK        (CryptoKey, non-extractable)
                                 │
                                 └─ AES-GCM wrap ─► data key (random, 32 bytes)
                                                      │
                                    per-record AES-GCM ┘  apiKey, settings
```

Why the extra layer:

- A password change rewraps one ~60-byte blob instead of re-encrypting every
  provider record, so it is atomic and cannot half-fail.
- The KDF parameters (`salt`, `iterations`) live in one versioned envelope, so
  raising the iteration count later does not orphan existing ciphertexts.
- Records carry the KDF metadata they were sealed under, which keeps the format
  self-describing if a second KDF is ever added.

### 2.2 Unlock lifetime and auto-lock

The unwrapped data key is held in two places only:

1. Service-worker memory (lost on suspension).
2. `browser.storage.session` — memory-only, cleared when the browser closes,
   unreachable from content scripts and pages.

That is a deliberate trade: it lets an unlocked wallet survive Chrome killing the
worker mid-conversation, while still requiring the password again after a browser
restart. An idle timeout (default 15 minutes, user-configurable, `0` disables)
is enforced in `requireDataKey()`, the single function every credential read goes
through — a caller cannot skip it by using a lower-level helper.

Threat model limits, stated honestly: `storage.session` is protected by the
extension boundary, not by the password. Malware running as the user, or a
malicious extension with equivalent privileges, can read it. The password
protects data at rest on disk, not a compromised browser.

## 3. Origin validation

- The only trusted source of an origin is the message sender metadata
  (`sender.origin`, or `sender.url` parsed as a fallback). A page-provided
  `origin` field is display information at best.
- A missing or unparsable origin fails closed with `OriginMismatch`.
- Iframes inherit the top-level origin only when the browser says so; the wallet
  never assumes embedding is safe.

## 4. Storage

- IndexedDB (`fluid-wallet`) holds providers, connections, sessions,
  conversations and logs; secrets inside provider records are encrypted
  envelopes, never raw strings.
- Conversation records are bound to `origin` and `appId`. The page SDK can only
  list what belongs to the caller; the wallet UI may read everything because it
  runs in the trusted context.
- Logs contain metadata only: origin, provider, model, timings, tokens, status.
  Prompt and response bodies are opt-in and subject to a retention policy.
- Exports are plain JSON **without** credentials. A separate, passphrase-sealed
  backup format carries the keys (see 4.1).

### 4.1 Encrypted backup

- The format is self-contained: KDF parameters travel with the ciphertext, so a
  file can be opened without the wallet that wrote it. A backup that only works
  on the machine it came from is not a backup.
- The backup passphrase is independent of the master password. Reusing the
  master password would make one compromise open both, and the file lives
  outside the extension where the master password was never meant to travel.
- Contents: provider records and their keys. **Never** grants, sessions, logs or
  conversations — a restored wallet must not silently re-authorise apps the user
  has not re-approved on that machine.
- Failures collapse to one message (wrong passphrase / damaged file), because
  distinguishing them helps an attacker more than the user.
- The in-wallet UI holds the plaintext in memory only for the duration of the
  export; nothing is written to disk unencrypted.

## 5. Logging and error hygiene

- Provider errors are truncated and re-mapped to protocol codes before leaving
  the runtime.
- Authorization headers, key fragments and full response bodies are never
  written to `console`, error messages or analytics.
- A test asserts that a provider auth failure does not echo the key.

## 6. Browser constraints that shape the design

1. Service workers are suspended at will → no authoritative in-memory state; a
   lost stream fails loudly instead of hanging.
2. Host permissions are user-visible and scary → request the narrowest origins
   possible and prefer on-demand injection over `<all_urls>`.
3. Page refresh, tab close and network loss all end streams → every stream has a
   terminal event or an idle timeout.
4. Content scripts run in an isolated world → the page-facing bridge is a
   separate MAIN-world script that cannot touch extension APIs.

## 7. Permission surface

The bridge needs to exist before the app calls `detect()`, which rules out
on-demand injection (`activeTab` + `chrome.scripting`): a page cannot ask for a
wallet that was never injected. The wallet therefore keeps two static content
scripts on `http://*/*` and `https://*/*`:

- `bridge.ts` (MAIN world) installs `window.fluid` and forwards opaque envelopes.
- `content.ts` (isolated world) relays to the service worker and back.

Neither reads page content, DOM, cookies or storage; both only ever touch
`window.postMessage` envelopes tagged with the protocol channel. The cost is the
store permission warning "read and change all your data on all websites", which
must be justified in the listing copy — it is a real trade, not a free one.

Provider endpoints are different: `host_permissions` only pre-grants DeepSeek,
and every other endpoint is requested at the moment the user adds it
(`optional_host_permissions`), so installing the wallet does not hand it access
to arbitrary hosts.

## 8. Review checklist before a public release

- [ ] No method returns credential material.
- [ ] Origin resolved from sender metadata in every handler.
- [ ] Revocation closes sessions synchronously.
- [ ] Payload limits applied before any provider call.
- [ ] No secret in logs, errors, analytics or exports.
- [ ] Vault re-derives on unlock; password never persisted.
- [ ] Extension permissions minimal and justified in the store listing.
