import { describe, expect, test } from "vitest";
import { runCommand, runCommandCapture } from "./commandRunner.js";

describe("commandRunner", () => {
  test("captures output and preserves command failure details", async () => {
    await expect(
      runCommandCapture(process.execPath, [
        "-e",
        "process.stdout.write('ready'); process.stderr.write('note')",
      ]),
    ).resolves.toEqual({ stdout: "ready", stderr: "note" });

    await expect(
      runCommand(process.execPath, [
        "-e",
        "process.stderr.write('failed'); process.exit(3)",
      ]),
    ).rejects.toThrow("failed");
  });
});
