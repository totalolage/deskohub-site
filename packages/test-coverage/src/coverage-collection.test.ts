import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CoverageMapData, FileCoverageData } from "istanbul-lib-coverage";
import { buildCoverageReport } from "./coverage-report";
import {
  coverageDumpFiles,
  coverageRunDirectoryVariable,
  writeCoverageRun,
} from "./coverage-run";
import { createSourceInstrumentation } from "./source-instrumentation";

const preload = join(import.meta.dir, "coverage-preload.ts");

const fixtureFiles = {
  "src/math.ts": `
export function add(a: number, b: number): number {
  return a + b;
}
export function sign(value: number): string {
  if (value < 0) {
    return "negative";
  }
  return "positive";
}
`,
  "src/greeting.tsx": `"use client";
export function greeting(name: string): string {
  return \`hello \${name}\`;
}
`,
  "src/environment.ts": `
export function environmentName(): string {
  return "test";
}
`,
  "src/script-only.ts": `
export function scriptOnly(): number {
  return 42;
}
`,
  "src/mocked.ts": `
export function mockedValue(): string {
  return "real";
}
`,
  "src/in-page.ts": `
export const readTitle = () => {
  const title = "page";
  return title.toUpperCase();
};
`,
  "src/fresh.ts": `
export function freshValue(): number {
  return 7;
}
`,
  "src/teardown.ts": `
export function fileTeardown(): void {}
`,
  "src/never-loaded.ts": `
export function neverLoaded(flag: boolean): number {
  return flag ? 1 : 0;
}
`,
  "scripts/child.ts": `
import { scriptOnly } from "../src/script-only";
process.exitCode = scriptOnly() === 42 ? 0 : 1;
`,
  "test-preload.ts": `
import { environmentName } from "./src/environment";
(globalThis as { fixtureEnvironment?: string }).fixtureEnvironment = environmentName();
`,
  "tests/math.test.ts": `
import { expect, test } from "bun:test";
import { add, sign } from "../src/math";
test("adds", () => {
  expect(add(1, 2)).toBe(3);
  expect(sign(1)).toBe("positive");
});
`,
  "tests/sign.test.ts": `
import { expect, mock, test } from "bun:test";
import { sign } from "../src/math";
import { greeting } from "../src/greeting";
mock.module("../src/mocked", () => ({ mockedValue: () => "mock" }));
test("signs and greets", async () => {
  const { mockedValue } = await import("../src/mocked");
  expect(mockedValue()).toBe("mock");
  expect(sign(-1)).toBe("negative");
  expect(greeting("bun")).toBe("hello bun");
  expect((globalThis as { fixtureEnvironment?: string }).fixtureEnvironment).toBe("test");
});
`,
  "tests/in-page.test.ts": `
import { afterAll, expect, test } from "bun:test";
import { readTitle } from "../src/in-page";
import { fileTeardown } from "../src/teardown";
afterAll(() => fileTeardown());
test("runs a function from its source text, as a browser page does", () => {
  expect(new Function(\`return (\${readTitle.toString()})();\`)()).toBe("PAGE");
});
`,
  "tests/fresh.test.ts": `
import { expect, test } from "bun:test";
test("imports fresh module instances through a query suffix", async () => {
  const first = await import("../src/fresh?first");
  const second = await import("../src/fresh.ts?second");
  expect(first.freshValue() + second.freshValue()).toBe(14);
});
`,
  "tests/child.test.ts": `
import { expect, test } from "bun:test";
test("runs a child script", async () => {
  const child = Bun.spawn([process.execPath, "scripts/child.ts"], { stdio: ["ignore", "inherit", "inherit"] });
  expect(await child.exited).toBe(0);
});
`,
};

const sourcePaths = [
  "src/math.ts",
  "src/greeting.tsx",
  "src/environment.ts",
  "src/script-only.ts",
  "src/mocked.ts",
  "src/in-page.ts",
  "src/teardown.ts",
  "src/fresh.ts",
  "src/never-loaded.ts",
];

let fixtureRoot: string | undefined;

afterEach(() => {
  if (fixtureRoot !== undefined) {
    rmSync(fixtureRoot, { recursive: true, force: true });
    fixtureRoot = undefined;
  }
});

async function collectFixtureCoverage(testArguments: ReadonlyArray<string>) {
  fixtureRoot = realpathSync(mkdtempSync(join(tmpdir(), "test-coverage-")));
  for (const [path, contents] of Object.entries(fixtureFiles)) {
    mkdirSync(join(fixtureRoot, path, ".."), { recursive: true });
    writeFileSync(join(fixtureRoot, path), contents);
  }
  const runDirectory = join(fixtureRoot, "coverage-run");
  const cacheDirectory = join(fixtureRoot, "coverage-cache");
  const sources = sourcePaths.map((path) => join(fixtureRoot as string, path));
  writeCoverageRun(runDirectory, { sources, cacheDirectory });

  const bunTest = Bun.spawn(
    [
      process.execPath,
      "test",
      "--preload=./test-preload.ts",
      ...testArguments,
      "tests",
    ],
    {
      cwd: fixtureRoot,
      env: {
        ...process.env,
        BUN_OPTIONS: `--preload=${preload}`,
        [coverageRunDirectoryVariable]: runDirectory,
      },
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  const [exitCode, output] = await Promise.all([
    bunTest.exited,
    new Response(bunTest.stderr).text(),
    new Response(bunTest.stdout).text(),
  ]);
  expect({ exitCode, output }).toMatchObject({ exitCode: 0 });

  const report = buildCoverageReport({
    dumpFiles: coverageDumpFiles(runDirectory),
    sources,
    instrumentation: createSourceInstrumentation(cacheDirectory),
  });
  return {
    report,
    file: (path: string) =>
      fileCoverage(report.coverage, join(fixtureRoot as string, path)),
  };
}

function fileCoverage(
  coverage: CoverageMapData,
  path: string
): FileCoverageData {
  const file = coverage[path];
  if (file === undefined) {
    throw new Error(`No coverage for ${path}`);
  }
  return file as FileCoverageData;
}

function functionCalls(
  file: FileCoverageData,
  name: string
): number | undefined {
  const entry = Object.entries(file.fnMap).find(([, fn]) => fn.name === name);
  return entry === undefined ? undefined : file.f[entry[0]];
}

describe.each([
  ["isolated test files", ["--parallel=1"]],
  ["a shared global", []],
])("coverage collection with %s", (_, testArguments) => {
  test("sums counters across test files and covers preloads, teardown, child scripts, query-suffixed imports, and unloaded sources", async () => {
    const { report, file } = await collectFixtureCoverage(testArguments);

    expect(Object.keys(report.coverage).sort()).toEqual(
      sourcePaths.map((path) => join(fixtureRoot as string, path)).sort()
    );
    expect(functionCalls(file("src/math.ts"), "add")).toBe(1);
    expect(functionCalls(file("src/math.ts"), "sign")).toBe(2);
    expect(file("src/math.ts").b).toEqual({ "0": [1, 1] });
    expect(functionCalls(file("src/greeting.tsx"), "greeting")).toBe(1);
    expect(
      functionCalls(file("src/environment.ts"), "environmentName")
    ).toBeGreaterThan(0);
    expect(functionCalls(file("src/script-only.ts"), "scriptOnly")).toBe(1);
    expect(functionCalls(file("src/mocked.ts"), "mockedValue")).toBe(0);
    expect(functionCalls(file("src/teardown.ts"), "fileTeardown")).toBe(1);
    expect(functionCalls(file("src/fresh.ts"), "freshValue")).toBe(2);

    const neverLoaded = file("src/never-loaded.ts");
    expect(functionCalls(neverLoaded, "neverLoaded")).toBe(0);
    expect(Object.values(neverLoaded.s).length).toBeGreaterThan(0);
    expect(Object.values(neverLoaded.s).every((count) => count === 0)).toBe(
      true
    );
    expect(report.unloadedFiles).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
