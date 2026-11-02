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
// instrumenter's version and options and on the counter guard, so all of them
// key the cache.
const counterGuardVersion = 1;
const cacheKeyPrefix = JSON.stringify([
  instrumenterPackage.version,
  instrumenterOptions,
  counterGuardVersion,
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
      const instrumented = guardCounters(
        instrumenter.instrumentSync(source, path)
      );
      writeFileAtomically(cached, instrumented);
      return instrumented;
    },
    unexecutedCoverage(path, source) {
      instrumenter.instrumentSync(source, path);
      return instrumenter.lastFileCoverage();
    },
  };
}

/**
 * Istanbul counts through a module-level `cov_<hash>()` function. Tests send
 * some functions to Playwright pages as source text, where that function does
 * not exist, so each counter falls back to an object that absorbs increments.
 */
function guardCounters(instrumented: string): string {
  const counter = /function (cov_\w+)\(\)/.exec(instrumented)?.[1];
  if (counter === undefined) {
    return instrumented;
  }
  return instrumented.replaceAll(
    new RegExp(`(?<!function )\\b${counter}\\(\\)`, "g"),
    `(typeof ${counter} === "function" ? ${counter}() : new Proxy(function () {}, { get: (_, key, proxy) => (key === Symbol.toPrimitive ? () => 0 : proxy), set: () => true }))`
  );
}

/** Writes through a sibling temporary file so readers never see a partial file. */
export function writeFileAtomically(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}-${randomUUID()}.tmp`;
  writeFileSync(temporary, contents);
  renameSync(temporary, path);
}
