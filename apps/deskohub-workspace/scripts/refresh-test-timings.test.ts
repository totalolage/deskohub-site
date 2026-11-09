import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  describeRecordingMismatch,
  formatTestTimings,
  isShardedTestFile,
  mergeTestTimings,
  parseTestTimings,
  predictShardDurations,
  testPathIgnorePatterns,
  testTimingsPath,
} from "./refresh-test-timings";

test("skips build-output checks and dependencies like the test script", () => {
  expect(isShardedTestFile("features/checkout/discount-code.test.ts")).toBe(
    true
  );
  expect(
    isShardedTestFile(
      "features/administration/i18n/administration-messages.build.test.ts"
    )
  ).toBe(false);
  expect(isShardedTestFile("node_modules/pkg/index.test.ts")).toBe(false);
});

test("reads every quoting of --path-ignore-patterns", () => {
  expect(
    testPathIgnorePatterns(
      `bun test --path-ignore-patterns='**/*.build.test.ts' --path-ignore-patterns="a b/**" --path-ignore-patterns c/**`
    )
  ).toEqual(["**/*.build.test.ts", "a b/**", "c/**"]);
});

test("reads --path-ignore-patterns followed by repeated spaces", () => {
  expect(
    testPathIgnorePatterns(
      "bun test --path-ignore-patterns   **/*.build.test.ts"
    )
  ).toEqual(["**/*.build.test.ts"]);
});

describe("mergeTestTimings", () => {
  test("combines shard recordings sorted by path with whole milliseconds", () => {
    expect(
      mergeTestTimings([
        { version: 1, files: { "b.test.ts": 20.4, "a.test.ts": 5 } },
        { version: 1, files: { "c/d.test.tsx": 7.6 } },
      ])
    ).toEqual({
      version: 1,
      files: { "a.test.ts": 5, "b.test.ts": 20, "c/d.test.tsx": 8 },
    });
  });

  test("rejects a file recorded by two shards", () => {
    expect(() =>
      mergeTestTimings([
        { version: 1, files: { "a.test.ts": 1 } },
        { version: 1, files: { "a.test.ts": 2 } },
      ])
    ).toThrow("a.test.ts was recorded by more than one shard");
  });
});

describe("describeRecordingMismatch", () => {
  test("accepts a run that timed exactly the checkout's test files", () => {
    expect(
      describeRecordingMismatch(["a.test.ts", "b.test.ts"], {
        version: 1,
        files: { "a.test.ts": 1, "b.test.ts": 2 },
      })
    ).toBeUndefined();
  });

  test("names both paths of a test file the base branch renamed", () => {
    const mismatch = describeRecordingMismatch(
      ["a.test.ts", "old-name.test.ts"],
      { version: 1, files: { "a.test.ts": 1, "new-name.test.ts": 2 } }
    );
    expect(mismatch).toContain("old-name.test.ts");
    expect(mismatch).toContain("new-name.test.ts");
    expect(mismatch).not.toContain("a.test.ts");
  });

  test("rejects a run that skipped a local test file", () => {
    expect(
      describeRecordingMismatch(["a.test.ts", "b.test.ts"], {
        version: 1,
        files: { "a.test.ts": 1 },
      })
    ).toContain("b.test.ts");
  });

  test("rejects a run that timed a file the checkout lacks", () => {
    expect(
      describeRecordingMismatch(["a.test.ts"], {
        version: 1,
        files: { "a.test.ts": 1, "deleted.test.ts": 2 },
      })
    ).toContain("deleted.test.ts");
  });
});

describe("predictShardDurations", () => {
  test("cuts path-ordered files at the shard marks like Bun", () => {
    expect(
      predictShardDurations(
        {
          version: 1,
          files: {
            "d.test.ts": 9,
            "a.test.ts": 4,
            "c.test.ts": 5,
            "b.test.ts": 10,
          },
        },
        2
      )
    ).toEqual([14, 14]);
  });

  test("keeps a file crossing a mark on the nearer side", () => {
    expect(
      predictShardDurations(
        {
          version: 1,
          files: { a: 10, b: 50, c: 5, d: 25, e: 1, f: 30 },
        },
        3
      )
    ).toEqual([60, 30, 31]);
  });
});

test("keeps the committed timings file valid and formatted", () => {
  const text = readFileSync(testTimingsPath, "utf8");
  const timings = parseTestTimings(text, "test-timings.json");
  expect(Object.keys(timings.files).length).toBeGreaterThan(0);
  expect(formatTestTimings(mergeTestTimings([timings]))).toBe(text);
});
