export { createTerminalDashboard } from "./dashboardController.js";

export function shouldUseTerminalDashboard(input: {
  inputTTY?: boolean;
  outputTTY?: boolean;
  nodeEnv?: string;
  lifecycleEvent?: string;
}): boolean {
  return Boolean(
    input.inputTTY &&
    input.outputTTY &&
    input.nodeEnv?.toLowerCase() !== "development" &&
    !input.lifecycleEvent?.startsWith("dev"),
  );
}
