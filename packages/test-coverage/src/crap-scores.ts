import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeFileAtomically } from "./source-instrumentation";
import { measuresCurrentSource, type SourceManifest } from "./source-manifest";

/** Functions at or above this CRAP score are violations. */
export const crapLimit = 10;

/**
 * Repository-relative globs outside business code: tests and their support
 * code, end-to-end suites, scripts, generated clients, build configuration,
 * and the test tooling packages.
 */
const nonBusinessSourceGlobs = [
  "**/*.test.*",
  "**/*.spec.*",
  "**/*.pw.*",
  "**/*.test-utils.*",
  "**/*.browser-harness.*",
  "**/*.d.ts",
  "**/*.config.*",
  "**/__tests__/**",
  "**/__mocks__/**",
  "**/__fixtures__/**",
  "**/fixtures/**",
  "**/fixtures.*",
  "**/testing/**",
  "**/test-utils/**",
  "**/e2e/**",
  "**/scripts/**",
  "**/generated/**",
  "**/*.gen.*",
  ".github/**",
  "lint/**",
  "packages/test-coverage/**",
  "packages/test-email/**",
] as const;

const nonBusinessSource = nonBusinessSourceGlobs.map(
  (pattern) => new Bun.Glob(pattern)
);

export function isBusinessSource(relativePath: string): boolean {
  return !nonBusinessSource.some((glob) => glob.match(relativePath));
}

/**
 * How the coverage behind a score was obtained. `measured` comes from an
 * Istanbul report whose source manifest matches the file's current content;
 * `stale` comes from a report taken against different content; `estimated` is
 * Fallow's static guess for a function the report has no counts for.
 */
type CoverageEvidence = "measured" | "stale" | "estimated";

export type FunctionCrap = {
  readonly path: string;
  readonly name: string;
  readonly line: number;
  readonly cyclomatic: number;
  readonly cognitive: number;
  readonly coveragePercent: number | null;
  readonly crap: number;
  readonly evidence: CoverageEvidence;
};

type FallowFinding = {
  readonly path: string;
  readonly name: string;
  readonly line: number;
  readonly cyclomatic: number;
  readonly cognitive: number;
  readonly crap?: number | null;
  readonly coverage_pct?: number | null;
  readonly coverage_source?: string | null;
};

const fallowBinary = (() => {
  const packageFile = Bun.resolveSync("fallow/package.json", import.meta.dir);
  const manifest = JSON.parse(readFileSync(packageFile, "utf8")) as {
    readonly bin: string | Readonly<Record<string, string>>;
  };
  const bin =
    typeof manifest.bin === "string" ? manifest.bin : manifest.bin.fallow;
  if (bin === undefined) {
    throw new Error("The fallow package declares no fallow binary");
  }
  return join(dirname(packageFile), bin);
})();

/**
 * Scores every function in the repository with Fallow's health analysis
 * against an Istanbul report. Fallow parses the current source, so the
 * manifest decides whether each file's counts still describe it.
 */
export async function scoreFunctions({
  repositoryRoot,
  coverageFile,
  manifest,
  workDirectory,
}: {
  readonly repositoryRoot: string;
  readonly coverageFile: string;
  readonly manifest: SourceManifest;
  readonly workDirectory: string;
}): Promise<FunctionCrap[]> {
  const config = join(workDirectory, "fallow-config.json");
  writeFileAtomically(
    config,
    JSON.stringify({ ignorePatterns: [".github/**"] })
  );
  const fallow = Bun.spawn(
    [
      fallowBinary,
      "health",
      repositoryRoot,
      "--production",
      "--no-cache",
      "--format",
      "json",
      "--complexity",
      "--report-only",
      "--max-cyclomatic",
      "65535",
      "--max-cognitive",
      "65535",
      // Every function scores at least 1, so all of them are reported.
      "--max-crap",
      "0.1",
      "--coverage",
      coverageFile,
      "--config",
      config,
    ],
    { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" }
  );
  const [output, errors, exitCode] = await Promise.all([
    new Response(fallow.stdout).text(),
    new Response(fallow.stderr).text(),
    fallow.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`fallow health exited with ${exitCode}:\n${errors}`);
  }
  const report = JSON.parse(output) as {
    readonly findings: ReadonlyArray<FallowFinding>;
  };
  const freshness = new Map<string, boolean>();
  const isFresh = (path: string) => {
    let fresh = freshness.get(path);
    if (fresh === undefined) {
      fresh = measuresCurrentSource(manifest, repositoryRoot, path);
      freshness.set(path, fresh);
    }
    return fresh;
  };
  return report.findings
    .filter((finding) => isBusinessSource(finding.path))
    .map((finding) => toFunctionCrap(finding, isFresh(finding.path)));
}

export function toFunctionCrap(
  finding: FallowFinding,
  sourceIsFresh: boolean
): FunctionCrap {
  if (typeof finding.crap !== "number") {
    throw new Error(
      `fallow reported no CRAP score for ${finding.path}:${finding.line} ${finding.name}`
    );
  }
  return {
    path: finding.path,
    name: finding.name,
    line: finding.line,
    cyclomatic: finding.cyclomatic,
    cognitive: finding.cognitive,
    coveragePercent: finding.coverage_pct ?? null,
    crap: finding.crap,
    evidence: evidenceFor(finding.coverage_source, sourceIsFresh),
  };
}

function evidenceFor(
  coverageSource: string | null | undefined,
  sourceIsFresh: boolean
): CoverageEvidence {
  if (coverageSource !== "istanbul") {
    return "estimated";
  }
  return sourceIsFresh ? "measured" : "stale";
}

export function isViolation(score: FunctionCrap): boolean {
  return score.crap >= crapLimit;
}

export type CrapIndex = {
  readonly revision: string;
  readonly coverageGeneratedAt: string;
  /** False when the report ran a subset of tests or some tests failed. */
  readonly completeCoverage: boolean;
  readonly businessFunctions: number;
  /** Evidence behind every business function's score. */
  readonly functionEvidence: Readonly<Record<CoverageEvidence, number>>;
  /** Evidence behind the scores of 10 or more. */
  readonly violationEvidence: Readonly<Record<CoverageEvidence, number>>;
  readonly violations: ReadonlyArray<FunctionCrap>;
  /** Every function whose score isn't measured, whatever the score. */
  readonly unmeasured: ReadonlyArray<FunctionCrap>;
};

export function buildCrapIndex(
  manifest: SourceManifest,
  scores: ReadonlyArray<FunctionCrap>
): CrapIndex {
  const violations = scores
    .filter(isViolation)
    .toSorted((left, right) => right.crap - left.crap);
  return {
    revision: manifest.revision,
    coverageGeneratedAt: manifest.generatedAt,
    completeCoverage:
      manifest.scope.kind === "complete" && manifest.testExitCode === 0,
    businessFunctions: scores.length,
    functionEvidence: countEvidence(scores),
    violationEvidence: countEvidence(violations),
    violations,
    unmeasured: scores.filter((score) => score.evidence !== "measured"),
  };
}

function countEvidence(
  scores: ReadonlyArray<FunctionCrap>
): Record<CoverageEvidence, number> {
  const counts = { measured: 0, stale: 0, estimated: 0 };
  for (const score of scores) {
    counts[score.evidence] += 1;
  }
  return counts;
}

/** One tab-separated row per score, for grep and spreadsheets. */
export function formatCrapTable(scores: ReadonlyArray<FunctionCrap>): string {
  const header = [
    "crap",
    "cyclomatic",
    "coverage",
    "evidence",
    "location",
    "function",
  ];
  const rows = scores.map((score) => [
    score.crap.toFixed(1),
    String(score.cyclomatic),
    score.coveragePercent === null
      ? "-"
      : `${score.coveragePercent.toFixed(1)}%`,
    score.evidence,
    `${score.path}:${score.line}`,
    score.name,
  ]);
  return [header, ...rows].map((row) => row.join("\t")).join("\n");
}
