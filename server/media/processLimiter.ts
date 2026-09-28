type Waiter = {
  grant: () => void;
  reject: (_reason: Error) => void;
  priority: "interactive" | "background";
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
  #backgroundActive = 0;
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
    priority: "interactive" | "background" = "interactive",
  ): Promise<Result> {
    await this.#acquire(signal, priority);
    try {
      if (signal?.aborted) throw abortError();
      return await task();
    } finally {
      this.#release(priority);
    }
  }

  #acquire(
    signal: AbortSignal | undefined,
    priority: "interactive" | "background",
  ): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortError());
    if (
      this.#active < this.limit &&
      (priority === "interactive" ||
        this.#backgroundActive < Math.max(1, this.limit - 1))
    ) {
      this.#active += 1;
      if (priority === "background") this.#backgroundActive += 1;
      return Promise.resolve();
    }

    return new Promise<void>((grant, reject) => {
      const waiter: Waiter = { grant, reject, signal, priority };
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

  #release(priority: "interactive" | "background"): void {
    this.#active -= 1;
    if (priority === "background") this.#backgroundActive -= 1;
    const backgroundIndex = this.#queue.findIndex(
      (waiter) =>
        waiter.priority === "background" &&
        this.#backgroundActive < Math.max(1, this.limit - 1),
    );
    const index =
      backgroundIndex >= 0
        ? backgroundIndex
        : this.#queue.findIndex((item) => item.priority === "interactive");
    if (index < 0) return;
    const waiter = this.#queue.splice(index, 1)[0];

    if (waiter.onAbort) {
      waiter.signal?.removeEventListener("abort", waiter.onAbort);
    }
    this.#active += 1;
    if (waiter.priority === "background") this.#backgroundActive += 1;
    waiter.grant();
  }
}
