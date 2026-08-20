type Waiter = {
  grant: () => void;
  reject: (_reason: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

function abortError(): Error {
  const error = new Error("The queued process was cancelled.");
  error.name = "AbortError";
  return error;
}

export class ProcessLimiter {
  readonly limit: number;
  #active = 0;
  #queue: Waiter[] = [];

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError("Process concurrency must be a positive integer.");
    }
    this.limit = limit;
  }

  async run<Result>(
    task: () => Promise<Result>,
    signal?: AbortSignal,
  ): Promise<Result> {
    await this.#acquire(signal);
    try {
      return await task();
    } finally {
      this.#release();
    }
  }

  #acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortError());
    if (this.#active < this.limit) {
      this.#active += 1;
      return Promise.resolve();
    }

    return new Promise<void>((grant, reject) => {
      const waiter: Waiter = { grant, reject, signal };
      if (signal) {
        waiter.onAbort = () => {
          const index = this.#queue.indexOf(waiter);
          if (index >= 0) this.#queue.splice(index, 1);
          reject(abortError());
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.#queue.push(waiter);
    });
  }

  #release(): void {
    this.#active -= 1;
    const waiter = this.#queue.shift();
    if (!waiter) return;

    if (waiter.onAbort) {
      waiter.signal?.removeEventListener("abort", waiter.onAbort);
    }
    this.#active += 1;
    waiter.grant();
  }
}
