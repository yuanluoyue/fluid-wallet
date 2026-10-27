# Streaming

Streaming is where browser wallets usually break: the service worker gets
suspended, a tab is closed, an iframe is sandboxed, and a "working" demo hangs
forever. This document pins the semantics down.

## 1. Correlation

`inference.create` is a **normal request** that also produces events.

- The caller generates `id` before sending.
- Every event for that call carries `requestId` equal to that id.
- The wallet uses the same value as `inferenceId` inside payloads, so an app can
  cancel without waiting for a first event.
- Events may arrive **before** the request promise resolves. Consumers must
  subscribe first, then await.

## 2. Event order

```
inference.start      (once, carries model + session)
inference.delta      (0..n, concatenate in order)
inference.tool-call  (0..n, model wants the app to run a tool)
inference.done | inference.error | inference.cancelled   (exactly once, terminal)
```

Guarantees:

- `delta` events are ordered and never duplicated within one request.
- Exactly one terminal event is sent per request.
- After a terminal event, no further events for that `requestId` are valid and
  must be ignored by consumers.
- A non-streamed call (`stream: false`) returns the same `FluidInferenceResult`
  in the response body and emits only `start` + `done`.

## 3. Idle timeout and cancellation

- If no event arrives for `streamIdleTimeoutMs` (30 s), the caller treats the
  stream as failed and calls `inference.cancel`.
- `inference.cancel` is advisory and idempotent: cancelling an unknown or
  finished request returns `{ cancelled: false }` rather than an error.
- After cancel, the wallet must emit `inference.cancelled` and stop forwarding
  provider output.

## 4. Service worker suspension

MV3 service workers are evicted aggressively. A wallet must therefore:

1. Keep no inference state that cannot be rebuilt from storage.
2. Treat a lost in-memory stream as `InferenceCancelled` with a clear message,
   never as a silent hang.
3. Re-emit the terminal event on reconnect when the client asks for it (see
   resume below).

## 5. Resume

`0.1.0` does not implement resume; the SDK surfaces the failure instead of
pretending the stream is alive:

- A stream with no terminal event and no heartbeat is cancelled after the idle
  timeout.
- The app may retry by starting a fresh `inference.create` with the same
  messages.

Resume is planned as an extension: the wallet would persist a `runId`, and the
SDK would call `inference.resume` with the last received sequence number. The
event shape already allows this because every event carries `requestId`.

## 6. Partial content

When a stream ends early (cancel, timeout, provider error):

- `inference.done` with `finishReason: "cancelled" | "error"` is **not** sent.
  The terminal event is `inference.cancelled` or `inference.error`.
- Whatever deltas were delivered remain valid text. The app decides whether to
  keep them.
- `FluidInferenceResult` is only produced for a completed generation.

## 7. Tool rounds

A tool round is not a new stream type, it is a sequence:

```
inference.start → delta* → tool-call → done(finishReason: "tool-calls")
  → app executes tools
  → inference.create with the tool results appended
  → inference.start → delta* → done(finishReason: "stop")
```

Each round is a separate request with its own `requestId`, which keeps
cancellation and logging precise.
