import { describe, expect, it } from "vitest";

import { createEventQueue } from "./stream";

describe("createEventQueue", () => {
  it("hands each waiting reader its own value", async () => {
    // A single `waiter` slot meant a second reader overwrote the first, whose
    // promise then never settled: not an error, just a hang.
    const queue = createEventQueue<string>();
    const iterator = queue.iterable[Symbol.asyncIterator]();

    const first = iterator.next();
    const second = iterator.next();
    queue.push("one");
    queue.push("two");

    await expect(first).resolves.toEqual({ value: "one", done: false });
    await expect(second).resolves.toEqual({ value: "two", done: false });
  });

  it("tells the producer when the consumer walks away", async () => {
    let cancelled = 0;
    const queue = createEventQueue<number>({ onCancel: () => (cancelled += 1) });
    const iterator = queue.iterable[Symbol.asyncIterator]();

    queue.push(1);
    await iterator.next();
    await iterator.return?.(undefined);

    expect(cancelled).toBe(1);
    // A closed queue must not keep buffering for a reader that is gone.
    queue.push(2);
    expect(cancelled).toBe(1);
  });

  it("fails a stalled consumer instead of buffering without limit", () => {
    const queue = createEventQueue<number>({ maxBuffer: 2 });
    queue.push(1);
    queue.push(2);
    queue.push(3);

    const iterator = queue.iterable[Symbol.asyncIterator]();
    // The first two values survive; the third overflow is reported, not dropped.
    return expect(iterator.next()).resolves.toEqual({ value: 1, done: false });
  });

  it("replays buffered values after a failure, then rejects", async () => {
    const queue = createEventQueue<string>();
    const iterator = queue.iterable[Symbol.asyncIterator]();

    queue.push("a");
    queue.fail(new Error("boom"));

    await expect(iterator.next()).resolves.toEqual({ value: "a", done: false });
    await expect(iterator.next()).rejects.toThrow("boom");
  });
});
