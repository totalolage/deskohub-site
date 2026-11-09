import { describe, expect, test } from "bun:test";
import { runSmokeCases } from "./smoke-case";

describe("runSmokeCases", () => {
  test("reports each case's actual value and keeps running after a failure", async () => {
    const report = await runSmokeCases([
      { group: "effect", name: "sync", run: () => "42" },
      {
        group: "shared",
        name: "throws",
        run: () => {
          throw new TypeError("undefined cannot be used as a constructor.");
        },
      },
      {
        group: "intl",
        name: "rejects",
        run: () => Promise.reject(new RangeError("bad time zone")),
      },
      { group: "i18n", name: "async", run: async () => "česká koruna" },
    ]);

    expect(report).toEqual({
      results: [
        { group: "effect", name: "sync", status: "PASS", actual: "42" },
        {
          group: "shared",
          name: "throws",
          status: "FAIL",
          actual: "TypeError: undefined cannot be used as a constructor.",
        },
        {
          group: "intl",
          name: "rejects",
          status: "FAIL",
          actual: "RangeError: bad time zone",
        },
        {
          group: "i18n",
          name: "async",
          status: "PASS",
          actual: "česká koruna",
        },
      ],
      passed: 2,
      failed: 2,
      total: 4,
    });
  });

  test("describes thrown values that are not errors", async () => {
    const report = await runSmokeCases([
      {
        group: "effect",
        name: "throws-prototypeless-object",
        run: () => {
          throw Object.create(null);
        },
      },
      {
        group: "effect",
        name: "rejects-text",
        run: () => Promise.reject("engine said no"),
      },
    ]);

    expect(report.results.map((result) => result.actual)).toEqual([
      "[object Object]",
      "engine said no",
    ]);
    expect(report.failed).toBe(2);
  });

  test("fails a case that outlives its timeout and runs the next one", async () => {
    const report = await runSmokeCases(
      [
        { group: "effect", name: "hangs", run: () => new Promise(() => {}) },
        { group: "effect", name: "after", run: () => "ran" },
      ],
      { caseTimeout: "20 millis" }
    );

    expect(report.results).toEqual([
      {
        group: "effect",
        name: "hangs",
        status: "FAIL",
        actual: "timed out after 20ms",
      },
      { group: "effect", name: "after", status: "PASS", actual: "ran" },
    ]);
  });
});
