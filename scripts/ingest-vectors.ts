import { ingestBlobIntoVector } from "../src/ingest/vectors";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

ingestBlobIntoVector({ catalogPath: option("--catalog") }).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
