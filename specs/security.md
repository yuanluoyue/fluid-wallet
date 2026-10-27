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
  page). `@fluid-wallet/crypto` is never imported by page code.
- The derived key is non-extractable and lives in memory only. Locking drops the
  reference; unlocking re-derives from the password.
- The unlock password is never stored — not in `chrome.storage`, not in
  IndexedDB, not in memory beyond the derivation call.

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
- Exports are plain JSON **without** credentials. Encrypted backups are a later,
  versioned format.

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

Requesting `<all_urls>` for a content script means "read and change all your data
on all websites". The scaffold declares it to make the bridge work in
development; MVP-02 must switch to on-demand injection (`activeTab` +
`chrome.scripting`) and document the change in the store listing.

## 8. Review checklist before a public release

- [ ] No method returns credential material.
- [ ] Origin resolved from sender metadata in every handler.
- [ ] Revocation closes sessions synchronously.
- [ ] Payload limits applied before any provider call.
- [ ] No secret in logs, errors, analytics or exports.
- [ ] Vault re-derives on unlock; password never persisted.
- [ ] Extension permissions minimal and justified in the store listing.
