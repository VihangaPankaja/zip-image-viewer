async function bootstrap() {
  await import("./appRuntime.js");
}

bootstrap().catch((error: unknown) => {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error("Failed to bootstrap server runtime", err);
  process.exit(1);
});
