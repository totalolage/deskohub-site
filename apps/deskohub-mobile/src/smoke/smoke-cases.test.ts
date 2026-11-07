import { beforeAll, describe, expect, test } from "bun:test";
import type { SmokeReport } from "./smoke-case";
import { runSmokeCases } from "./smoke-case";
import { smokeCases } from "./smoke-cases";

describe("smoke cases on Bun", () => {
  let report: SmokeReport;

  beforeAll(async () => {
    report = await runSmokeCases(smokeCases);
  });

  test("every case passes", () => {
    expect(report.results.filter((result) => result.status === "FAIL")).toEqual(
      []
    );
    expect(report).toMatchObject({
      passed: smokeCases.length,
      failed: 0,
      total: smokeCases.length,
    });
  });

  test("case names are unique within their group", () => {
    const keys = smokeCases.map(
      (smokeCase) => `${smokeCase.group}/${smokeCase.name}`
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});
