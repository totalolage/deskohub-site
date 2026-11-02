import { describe, expect, test } from "bun:test";
import {
  buildCrapIndex,
  formatCrapTable,
  isBusinessSource,
  toFunctionCrap,
} from "./crap-scores";
import type { SourceManifest } from "./source-manifest";

test.each([
  ["apps/deskohub-workspace/features/checkout/pricing.ts", true],
  ["apps/deskohub-workspace/app/[locale]/(site)/page.tsx", true],
  ["packages/dotypos/src/index.ts", true],
  ["apps/dhw/src/commands/release.ts", true],
  ["apps/deskohub-workspace/features/checkout/pricing.test.ts", false],
  ["apps/deskohub-workspace/e2e/account/sign-in.ts", false],
  ["apps/deskohub-workspace/shared/testing/workspace-test-env.ts", false],
  ["apps/deskohub-workspace/shared/lock-waiters.test-utils.ts", false],
  ["apps/deskohub-workspace/scripts/production-release.ts", false],
  [
    "apps/deskohub-workspace/shared/browser/image-downscaling.browser-harness.ts",
    false,
  ],
  ["apps/deskohub-workspace/features/administration/fixtures.ts", false],
  ["scripts/generate-effect-openapi-client.ts", false],
  ["packages/dotypos/src/generated/client.ts", false],
  ["packages/posthog/src/generated/effect.gen.ts", false],
  ["apps/deskohub-workspace/playwright.e2e.config.ts", false],
  ["packages/test-coverage/src/crap.ts", false],
  ["packages/test-email/src/index.ts", false],
  [".github/actions/workspace-e2e-allocation/index.mjs", false],
])("isBusinessSource(%p) is %p", (path, expected) => {
  expect(isBusinessSource(path)).toBe(expected);
});

const finding = {
  path: "packages/osm/src/static-map.ts",
  name: "createStaticMapInput",
  line: 293,
  cyclomatic: 14,
  cognitive: 9,
  crap: 14,
  coverage_pct: 94.7,
  coverage_source: "istanbul",
};

describe("toFunctionCrap", () => {
  test("Istanbul counts for unchanged source are measured", () => {
    expect(toFunctionCrap(finding, true).evidence).toBe("measured");
  });

  test("Istanbul counts for changed source are stale", () => {
    expect(toFunctionCrap(finding, false).evidence).toBe("stale");
  });

  test("Fallow's static guess is estimated even for unchanged source", () => {
    expect(
      toFunctionCrap({ ...finding, coverage_source: "estimated" }, true)
        .evidence
    ).toBe("estimated");
  });

  test("a finding without a score is an error, not a pass", () => {
    expect(() => toFunctionCrap({ ...finding, crap: null }, true)).toThrow();
  });
});

const manifest: SourceManifest = {
  revision: "abc123",
  generatedAt: "2026-11-02T10:00:00.000Z",
  scope: { kind: "complete" },
  testExitCode: 0,
  files: {},
};

describe("buildCrapIndex", () => {
  const scores = [
    toFunctionCrap({ ...finding, name: "under", crap: 9.9 }, true),
    toFunctionCrap({ ...finding, name: "at", crap: 10 }, true),
    toFunctionCrap({ ...finding, name: "stale", crap: 30 }, false),
    toFunctionCrap(
      { ...finding, name: "estimated", crap: 12, coverage_source: "estimated" },
      true
    ),
  ];

  test("lists functions scoring 10 or more, worst first, and counts the evidence behind every score", () => {
    const index = buildCrapIndex(manifest, scores);
    expect(index.violations.map((score) => score.name)).toEqual([
      "stale",
      "estimated",
      "at",
    ]);
    expect(index.violationEvidence).toEqual({
      measured: 1,
      stale: 1,
      estimated: 1,
    });
    expect(index.functionEvidence).toEqual({
      measured: 2,
      stale: 1,
      estimated: 1,
    });
    expect(index.unmeasured.map((score) => score.name)).toEqual([
      "stale",
      "estimated",
    ]);
    expect(index.businessFunctions).toBe(4);
    expect(index.completeCoverage).toBe(true);
  });

  test("coverage from a subset of tests or a failed run is incomplete", () => {
    expect(
      buildCrapIndex(
        { ...manifest, scope: { kind: "partial", tests: ["a.test.ts"] } },
        scores
      ).completeCoverage
    ).toBe(false);
    expect(
      buildCrapIndex({ ...manifest, testExitCode: 1 }, scores).completeCoverage
    ).toBe(false);
  });
});

test("formatCrapTable writes one tab-separated row per function", () => {
  expect(
    formatCrapTable([
      toFunctionCrap(finding, true),
      toFunctionCrap({ ...finding, coverage_pct: null }, true),
    ]).split("\n")
  ).toEqual([
    "crap\tcyclomatic\tcoverage\tevidence\tlocation\tfunction",
    "14.0\t14\t94.7%\tmeasured\tpackages/osm/src/static-map.ts:293\tcreateStaticMapInput",
    "14.0\t14\t-\tmeasured\tpackages/osm/src/static-map.ts:293\tcreateStaticMapInput",
  ]);
});
