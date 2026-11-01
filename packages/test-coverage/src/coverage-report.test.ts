import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCoverageReport } from "./coverage-report";
import { createSourceInstrumentation } from "./source-instrumentation";

let directory: string | undefined;

afterEach(() => {
  if (directory !== undefined) {
    rmSync(directory, { recursive: true, force: true });
    directory = undefined;
  }
});

function fixture() {
  directory = realpathSync(mkdtempSync(join(tmpdir(), "coverage-report-")));
  const source = join(directory, "source.ts");
  writeFileSync(source, "export const one = () => 1;\n");
  const instrumentation = createSourceInstrumentation(join(directory, "cache"));
  return { directory, source, instrumentation };
}

test("rejects a dump that is not Istanbul coverage", () => {
  const { directory, source, instrumentation } = fixture();
  const dump = join(directory, "dump.json");
  writeFileSync(
    dump,
    JSON.stringify({
      [source]: {
        path: source,
        statementMap: true,
        fnMap: {},
        branchMap: {},
        s: true,
        f: {},
        b: {},
      },
    })
  );

  expect(() =>
    buildCoverageReport({
      dumpFiles: [dump],
      sources: [source],
      instrumentation,
    })
  ).toThrow("Malformed coverage dump");
});

test("rejects a dump covering a file outside the run's sources", () => {
  const { directory, source, instrumentation } = fixture();
  const stray = join(directory, "stray.ts");
  writeFileSync(stray, "export const two = () => 2;\n");
  const dump = join(directory, "dump.json");
  writeFileSync(
    dump,
    JSON.stringify({
      [stray]: instrumentation.unexecutedCoverage(
        stray,
        "export const two = () => 2;\n"
      ),
    })
  );

  expect(() =>
    buildCoverageReport({
      dumpFiles: [dump],
      sources: [source],
      instrumentation,
    })
  ).toThrow("outside the run's sources");
});
