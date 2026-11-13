import { runIngest } from "../src/ingest/engine";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function flag(name: string): boolean {
  return process.argv.includes(name);
}

const limitArg = option("--limit");

runIngest({
  sourceDir: option("--source") ?? process.env.SOURCE_DIR ?? "Source",
  catalogPath: option("--catalog"),
  limit: limitArg ? Number(limitArg) : undefined,
  dryRun: flag("--dry-run"),
  force: flag("--force"),
})
  .then((result) => {
    if (result.database === "failed" || result.blob === "failed") {
      process.exitCode = 1;
    }
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
