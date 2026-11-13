import { understandLibrary } from "../src/ingest/understand";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

const limitArg = option("--limit");

understandLibrary({
  sourceDir: option("--source"),
  catalogPath: option("--catalog"),
  limit: limitArg ? Number(limitArg) : undefined,
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
