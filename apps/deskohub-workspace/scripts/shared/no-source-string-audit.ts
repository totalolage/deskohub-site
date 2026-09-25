import { execSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * Deterministic audit: no tracked test may pin literal substrings of tracked
 * repository source files (the "source-as-string contract" pattern).
 *
 * A test file violates the rule when it both
 *  1. reads a tracked repository source file into a variable, and
 *  2. pins that variable with literal-string assertions
 *     (`expect(<sourceVar>).toContain("...")` / `.toMatch("...")`).
 *
 * Verdicts computed structurally from real modules (parsed YAML, JSON config,
 * import graphs, extracted identifiers/counts, runtime behavior) are the
 * sanctioned replacements and are not flagged.
 *
 * Reads that exercise generated artifacts rather than hand-written sources are
 * allowlisted explicitly below with their justification.
 */

/** Generated SQL migrations: applied against a live disposable database. */
const GENERATED_MIGRATION_READS = [
  "apps/deskohub-workspace/db/schema/cli-authentication.test.ts",
  "apps/deskohub-workspace/db/schema/customer-account-links.test.ts",
  "apps/deskohub-workspace/db/schema/customer-marketing-consents.test.ts",
  "apps/deskohub-workspace/db/schema/discounts.test.ts",
  "apps/deskohub-workspace/db/schema/payment-attempts.test.ts",
  "apps/deskohub-workspace/db/schema/standalone-access-code-attempt-events.test.ts",
  "apps/deskohub-workspace/db/schema/workspace-reservations.test.ts",
];

/** Generated codegen output or synthetic temp fixtures, never hand-written source. */
const GENERATED_FIXTURE_READS = [
  "packages/games/src/generate.test.ts",
  "packages/posthog/src/feature-flags/codegen.test.ts",
  "apps/deskohub-workspace/scripts/postcss-config.test.ts",
  "apps/deskohub-workspace/scripts/sync-posthog-feature-flags.test.ts",
  "apps/deskohub-workspace/scripts/account-visual/run.test.tsx",
  "apps/deskohub-workspace/scripts/account-visual/marketing-preferences-browser.test.tsx",
];

/** Static policy/convention scanners: verdicts computed from real structure. */
const POLICY_SCANNERS = [
  "apps/deskohub-workspace/db/schema/checkout-lifecycle.no-pii.test.ts",
  "apps/deskohub-workspace/scripts/preview-data-boundary.test.ts",
  "apps/deskohub-workspace/scripts/anti-slop.test.ts",
  "features/gallery/cloudinary-boundary.test.ts",
];

/** Owned by the parallel auth-facade fix; conversion is out of scope here. */
const PARALLEL_FIX_OWNED = [
  "apps/deskohub-workspace/e2e/account-legal-continuity.test.ts",
];

const normalizePath = (path: string): string =>
  path
    .replace(/^\.\//, "")
    .replace(/^apps\/deskohub-workspace\//, "")
    .replace(/^deskohub-workspace\//, "");

const ALLOWLIST = new Set(
  [
    ...GENERATED_MIGRATION_READS,
    ...GENERATED_FIXTURE_READS,
    ...POLICY_SCANNERS,
    ...PARALLEL_FIX_OWNED,
  ].map(normalizePath)
);

const SOURCE_READ = /\b(?:Bun\.file|readFileSync|readFile|readFileString)\s*\(/;
const DIRECT_READ =
  /\bconst\s+(\w+)\s*=\s*(?:await\s+)?(?:readFileSync|Bun\.file|readFile|readFileString)\s*\(([\s\S]{0,240}?)[;)]/g;
const REPO_SOURCE_ARG =
  /new URL\(|import\.meta|repoFile\(|["']\.\/|["']\.\.|repoRoot/;
const DERIVED_READ =
  /\bconst\s+(\w+)\s*=\s*(\w+)\.(?:slice|split|substring|replace|trim)\s*\(/;

const LITERAL_PIN_ON = (variable: string) =>
  new RegExp(
    `expect\\(\\s*${variable}\\s*\\)\\s*\\.\\s*(?:not\\.)?\\s*(?:toContain|toMatch|toContainEqual)\\s*\\(\\s*(?:"[^"]*"|'[^']*')`
  );

export const listTrackedTestFiles = (): readonly string[] =>
  execSync("git ls-files -- '*.test.ts' '*.test.tsx'", {
    cwd: resolve(import.meta.dir, "../.."),
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

export const findViolations = (
  files: readonly { readonly path: string; readonly content: string }[]
): readonly string[] => {
  const violations: string[] = [];

  for (const { path, content } of files) {
    if (ALLOWLIST.has(normalizePath(path))) continue;
    if (!SOURCE_READ.test(content)) continue;

    // Track variables that hold repository file contents (the read call must
    // address a repository source, not a runtime temp/output file), plus one
    // level of string-derived copies (slices/splits of a read).
    const sourceVars = new Set<string>();
    for (const match of content.matchAll(DIRECT_READ)) {
      if (REPO_SOURCE_ARG.test(match[2] ?? "")) {
        sourceVars.add(match[1] ?? "");
      }
    }
    for (const match of content.matchAll(
      new RegExp(DERIVED_READ.source, "g")
    )) {
      if (sourceVars.has(match[2] ?? "")) sourceVars.add(match[1] ?? "");
    }

    for (const variable of sourceVars) {
      if (variable.length === 0) continue;
      if (LITERAL_PIN_ON(variable).test(content)) {
        violations.push(
          `${path}: literal pins on source variable \`${variable}\``
        );
      }
    }
  }

  return violations.sort();
};
