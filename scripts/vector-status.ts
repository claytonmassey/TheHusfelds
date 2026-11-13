import { readVectorProgress } from "../src/lib/vector-progress";

readVectorProgress()
  .then((progress) => {
    const described = progress.total > 0 ? `${progress.described} of ${progress.total}` : String(progress.described);
    console.log(`${described} transcribed`);
    console.log(`${progress.stored} stored in Upstash`);
    if (progress.described < progress.total) {
      console.log("GPT is still transcribing text. Upstash fills in after that pass finishes.");
    }
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
