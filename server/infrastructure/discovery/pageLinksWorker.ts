import { parentPort, workerData } from "node:worker_threads";
import { extractPageLinks } from "./pageLinks.js";

const input: unknown = workerData;
if (
  !input ||
  typeof input !== "object" ||
  !("markup" in input) ||
  !("sourcePage" in input) ||
  typeof input.markup !== "string" ||
  typeof input.sourcePage !== "string"
)
  throw new Error("Invalid page parsing input.");
parentPort?.postMessage(extractPageLinks(input.markup, input.sourcePage));
