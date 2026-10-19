// Runs the after-compile hook of the Next config in the working directory
// for `scripts/next-build.ts`; see `next-build-after-compile.mjs`. The config
// imports that module, so this entry point stays out of it.
import { runAfterCompile } from "./next-build-after-compile.mjs";

await runAfterCompile(process.cwd());
