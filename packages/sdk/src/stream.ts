/**
 * Minimal pull-based async queue.
 *
 * Streaming events arrive over a callback subscription while callers consume
 * them with `for await`. The queue is single-consumer by design: one inference
 * handle owns one queue.
 */
export interface EventQueue<T> {
  readonly iterable: AsyncIterable<T>;
  push(value: T): void;
  close(): void;
  fail(error: unknown): void;
}

export function createEventQueue<T>(): EventQueue<T> {
  const buffer: T[] = [];
  let closed = false;
  let failure: { error: unknown } | null = null;
  let waiter: {
    resolve: (result: IteratorResult<T>) => void;
    reject: (error: unknown) => void;
  } | null = null;

  const flush = (): void => {
    if (!waiter) return;
    const current = waiter;

    if (buffer.length > 0) {
      waiter = null;
      current.resolve({ value: buffer.shift() as T, done: false });
      return;
    }
    if (failure) {
      waiter = null;
      current.reject(failure.error);
      return;
    }
    if (closed) {
      waiter = null;
      current.resolve({ value: undefined, done: true });
    }
  };

  const iterable: AsyncIterable<T> = {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next(): Promise<IteratorResult<T>> {
          if (buffer.length > 0) {
            return Promise.resolve({ value: buffer.shift() as T, done: false });
          }
          if (failure) return Promise.reject(failure.error);
          if (closed) return Promise.resolve({ value: undefined, done: true });

          return new Promise<IteratorResult<T>>((resolve, reject) => {
            waiter = { resolve, reject };
          });
        },
        return(): Promise<IteratorResult<T>> {
          closed = true;
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };

  return {
    iterable,
    push(value: T): void {
      if (closed || failure) return;
      buffer.push(value);
      flush();
    },
    close(): void {
      if (closed) return;
      closed = true;
      flush();
    },
    fail(error: unknown): void {
      if (closed || failure) return;
      failure = { error };
      flush();
    },
  };
}
