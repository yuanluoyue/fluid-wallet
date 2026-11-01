import { FluidError, FluidErrorCode } from "@fluid-wallet/protocol";

/**
 * Minimal pull-based async queue.
 *
 * Streaming events arrive over a callback subscription while callers consume
 * them with `for await`. One inference handle owns one queue, but the queue
 * does not assume that: a second reader gets its own turn instead of silently
 * replacing the first one's pending promise.
 */
export interface EventQueueOptions {
  /**
   * Runs once when the consumer stops early — `break`, `throw`, or an explicit
   * `return()`. Without it, abandoning a stream leaves the wallet generating
   * into a queue nobody will read, which is the difference between cancelling a
   * request and hiding from it.
   */
  onCancel?: () => void;
  /** Buffered values allowed before a stalled consumer is treated as a bug. */
  maxBuffer?: number;
}

export interface EventQueue<T> {
  readonly iterable: AsyncIterable<T>;
  push(value: T): void;
  close(): void;
  fail(error: unknown): void;
}

interface Waiter<T> {
  resolve: (result: IteratorResult<T>) => void;
  reject: (error: unknown) => void;
}

/** Large enough for any real burst, small enough to catch a consumer that died. */
const DEFAULT_MAX_BUFFER = 4_096;

export function createEventQueue<T>(options: EventQueueOptions = {}): EventQueue<T> {
  const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
  const buffer: T[] = [];
  let head = 0;
  let closed = false;
  let settled = false;
  let failure: { error: unknown } | null = null;
  const waiters: Waiter<T>[] = [];

  const take = (): T | undefined => {
    if (head >= buffer.length) return undefined;
    const value = buffer[head] as T;
    head += 1;
    // Reclaim the consumed prefix so a long infrequent stream does not hold
    // every delta it ever saw.
    if (head > 256 && head * 2 > buffer.length) {
      buffer.splice(0, head);
      head = 0;
    }
    return value;
  };

  const drain = (): void => {
    while (waiters.length > 0) {
      const waiter = waiters.shift() as Waiter<T>;
      const value = take();

      if (value !== undefined) {
        waiter.resolve({ value, done: false });
        continue;
      }
      if (failure) {
        waiter.reject(failure.error);
        continue;
      }
      if (closed) {
        waiter.resolve({ value: undefined, done: true });
        continue;
      }
      // Nothing to hand out yet: this waiter goes back to the front of the line.
      waiters.unshift(waiter);
      return;
    }
  };

  const iterable: AsyncIterable<T> = {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next(): Promise<IteratorResult<T>> {
          const value = take();
          if (value !== undefined) return Promise.resolve({ value, done: false });
          if (failure) return Promise.reject(failure.error);
          if (closed) return Promise.resolve({ value: undefined, done: true });

          return new Promise<IteratorResult<T>>((resolve, reject) => {
            waiters.push({ resolve, reject });
          });
        },

        return(): Promise<IteratorResult<T>> {
          // A consumer that walks away is a cancellation, not an ending: the
          // producer has to be told, or it keeps working for nobody.
          if (!settled) {
            settled = true;
            closed = true;
            options.onCancel?.();
          }
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };

  return {
    iterable,

    push(value: T): void {
      if (closed || failure) return;
      if (buffer.length - head >= maxBuffer) {
        settled = true;
        failure = {
          error: new FluidError(
            FluidErrorCode.InternalError,
            `Stream buffer exceeded ${maxBuffer} events; the consumer stopped reading.`,
          ),
        };
        waiters.splice(0).forEach((waiter) => waiter.reject(failure?.error));
        options.onCancel?.();
        return;
      }
      buffer.push(value);
      drain();
    },

    close(): void {
      if (closed || failure) return;
      closed = true;
      drain();
    },

    fail(error: unknown): void {
      if (closed || failure) return;
      failure = { error };
      drain();
    },
  };
}
