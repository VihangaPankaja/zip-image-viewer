import { Worker } from "node:worker_threads";
import { pageDiscoverySchema, type PageDiscovery } from "../../../shared/contracts.js";
import { errorFromUnknown } from "../runtime/mediaClassification.js";

export async function parsePage(markup: string, sourcePage: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const source = import.meta.url.endsWith(".ts");
  const worker = new Worker(
    new URL(source ? "./pageLinksWorker.ts" : "./pageLinksWorker.js", import.meta.url),
    {
      workerData: { markup, sourcePage },
      execArgv: source ? ["--import", "tsx"] : [],
      resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    },
  );
  let abort: () => void = () => {};
  try {
    return await new Promise<PageDiscovery>((resolve, reject) => {
      abort = () => reject(errorFromUnknown(signal.reason));
      signal.addEventListener("abort", abort, { once: true });
      worker.once("message", (message: unknown) => {
        try {
          signal.throwIfAborted();
          resolve(pageDiscoverySchema.parse(message));
        } catch (error) {
          reject(errorFromUnknown(error));
        }
      });
      worker.once("error", reject);
      worker.once("exit", () =>
        reject(new Error("Page parsing stopped before returning results.")),
      );
      if (signal.aborted) abort();
    });
  } finally {
    signal.removeEventListener("abort", abort);
    await worker.terminate();
  }
}
