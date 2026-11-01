import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { FileCoverageData } from "istanbul-lib-coverage";
import { createInstrumenter } from "istanbul-lib-instrument";
import instrumenterPackage from "istanbul-lib-instrument/package.json" with {
  type: "json",
};

const instrumenterOptions = {
  esModules: true,
  compact: false,
  produceSourceMap: false,
  // Bun runs each isolated test file in a fresh global, so the counters
  // must live on that file's globalThis.
  coverageGlobalScope: "globalThis",
  coverageGlobalScopeFunc: false,
  parserPlugins: ["typescript", "jsx", "importAttributes", "decorators-legacy"],
};

// The instrumented code embeds the file path and depends on the
// instrumenter's version and options, so all of them key the cache.
const cacheKeyPrefix = JSON.stringify([
  instrumenterPackage.version,
  instrumenterOptions,
]);

export type SourceInstrumentation = {
  /** Instrumented code for a source file, reused from the cache directory. */
  readonly instrument: (path: string, source: string) => string;
  /** Zero-count Istanbul coverage for a source file no test loaded. */
  readonly unexecutedCoverage: (
    path: string,
    source: string
  ) => FileCoverageData;
};

export function createSourceInstrumentation(
  cacheDirectory: string
): SourceInstrumentation {
  const instrumenter = createInstrumenter(instrumenterOptions);
  return {
    instrument(path, source) {
      const key = createHash("sha256")
        .update(cacheKeyPrefix)
        .update("\0")
        .update(path)
        .update("\0")
        .update(source)
        .digest("hex");
      const cached = join(cacheDirectory, `${key}.js`);
      if (existsSync(cached)) {
        return readFileSync(cached, "utf8");
      }
      const instrumented = instrumenter.instrumentSync(source, path);
      writeFileAtomically(cached, instrumented);
      return instrumented;
    },
    unexecutedCoverage(path, source) {
      instrumenter.instrumentSync(source, path);
      return instrumenter.lastFileCoverage();
    },
  };
}

/** Writes through a sibling temporary file so readers never see a partial file. */
export function writeFileAtomically(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}-${randomUUID()}.tmp`;
  writeFileSync(temporary, contents);
  renameSync(temporary, path);
}
