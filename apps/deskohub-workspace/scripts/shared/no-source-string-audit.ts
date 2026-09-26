import { execSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * Deterministic audit: no tracked test may pin literal substrings of tracked
 * repository TS/TSX source files (the "source-as-string contract" pattern).
 *
 * A test file violates the rule when it both
 *  1. reads a tracked repository TS/TSX source file into a variable (directly
 *     via `Bun.file`/`readFileSync`/... or through a wrapper helper such as
 *     `readTrackedSource`), and
 *  2. pins that variable with literal-string assertions or their equivalent
 *     evasion forms: `expect(<var>.includes("...")).toBe(...)` on a source
 *     variable, literal-argument `indexOf`/`includes` searches, regex
 *     matchers applied to the variable, and count-occurrence helpers fed
 *     with the variable.
 *
 * The enumeration is repository-wide: every tracked `*.test.ts(x)` under the
 * repo root is audited, not only the Workspace app.
 *
 * Sanctioned replacements compute verdicts structurally — parsed-TypeScript
 * AST checks (`scripts/shared/source-ast.ts`), executed runtime/module
 * behavior, parsed YAML/JSON config, and generated-output comparisons — and
 * are never flagged.
 *
 * Contract boundary (by scope, not per-file allowlist): the rule covers
 * hand-written TS/TSX sources only. Reads whose target is a shell script,
 * environment documentation, YAML/JSON config, Markdown, or plain text are
 * outside the TS source contract and are not flagged. Generated migration
 * SQL and generated codegen output remain explicit allowlist exceptions
 * because their verdicts exercise generated artifacts, not hand-written
 * source.
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

const normalizePath = (path: string): string =>
  path
    .replace(/^\.\//, "")
    .replace(/^apps\/deskohub-workspace\//, "")
    .replace(/^deskohub-workspace\//, "");

const ALLOWLIST = new Set(
  [...GENERATED_MIGRATION_READS, ...GENERATED_FIXTURE_READS].map(normalizePath)
);

const SOURCE_READ =
  /\b(?:Bun\.file|readFileSync|readFile|readFileString)\s*\(|\b\w*[Rr]ead(?:Tracked|Source)\w*(?<!Json)(?<!Tokens)\s*\(/;
const DIRECT_READ =
  /\bconst\s+(\w+)\s*=\s*(?:await\s+)?(?:readFileSync|readFile|readFileString|Bun\.file|\w*[Rr]ead(?:Tracked|Source)\w*(?<!Json)(?<!Tokens))\s*\(([\s\S]{0,240}?)[;)]/g;
const REPO_SOURCE_ARG =
  /new URL\(|import\.meta|repoFile\(|["']\.\/|["']\.\.|repoRoot/;
/**
 * Out-of-scope read targets: shell scripts, environment docs, YAML/JSON
 * config, Markdown, and plain text live outside the TS/TSX source contract.
 * The pattern only applies when the argument names no `.ts`/`.tsx` target.
 */
const NON_TS_TARGET =
  /\.sh\b|\.env\.|\.env\b|\.ya?ml\b|\.json\b|\.md\b|\.txt\b|\.csv\b/;
const TS_TARGET = /\.tsx?\b/;
const DERIVED_READ =
  /\bconst\s+(\w+)\s*=\s*(\w+)\.(?:slice|split|substring|replace|trim)\s*\(/;

const LITERAL_PIN_ON = (variable: string) =>
  new RegExp(
    `expect\\(\\s*${variable}\\s*\\)\\s*\\.\\s*(?:not\\.)?\\s*(?:toContain|toMatch|toContainEqual)\\s*\\(\\s*(?:"[^"]*"|'[^']*'|/(?:[^/\\\\\\n]|\\\\.)+/[a-z]*|new\\s+RegExp\\s*\\()`
  );

/**
 * Evasion forms equivalent to a literal pin: literal-argument searches on the
 * source variable, regex matchers applied to it, and count-occurrence
 * helpers fed with it.
 */
const SEARCH_PIN_ON = (variable: string): readonly RegExp[] => [
  new RegExp(
    `\\b${variable}\\s*\\.\\s*(?:includes|indexOf|lastIndexOf|search)\\s*\\(\\s*(?:"[^"]*"|'[^']*')`
  ),
  new RegExp(
    `/(?:[^/\\n\\\\]|\\\\.)+/[a-z]*\\s*\\.\\s*test\\s*\\(\\s*${variable}\\s*\\)`
  ),
  new RegExp(
    `new\\s+RegExp\\s*\\([^)]{0,200}?\\)\\s*\\.\\s*test\\s*\\(\\s*${variable}\\s*\\)`
  ),
  new RegExp(`\\b${variable}\\s*\\.\\s*match\\s*\\(\\s*(?:"|'|/)`),
  new RegExp(
    `\\b(?![A-Za-z_]*Token)(?:\\w*)(?:[Cc]ount(?:Occurrences|Matches|Of)?|[Oo]ccurrences)\\w*\\s*\\(\\s*${variable}\\b`
  ),
  new RegExp(
    `\\b${variable}\\s*\\.\\s*split\\s*\\(\\s*(?:"[^"]*"|'[^']*')\\s*\\)\\s*\\.\\s*length`
  ),
];

let cachedRepositoryRoot: string | undefined;

/** Absolute root of the repository that owns this script. */
export const repositoryRoot = (): string => {
  if (cachedRepositoryRoot === undefined) {
    cachedRepositoryRoot = execSync("git rev-parse --show-toplevel", {
      cwd: resolve(import.meta.dir, "../.."),
      encoding: "utf8",
    }).trim();
  }
  return cachedRepositoryRoot;
};

/** Every tracked test file in the repository, relative to the repo root. */
export const listTrackedTestFiles = (): readonly string[] =>
  execSync("git ls-files -- '*.test.ts' '*.test.tsx'", {
    cwd: repositoryRoot(),
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

    // Track variables that hold repository TS/TSX file contents (the read
    // call must address a repository source, not a runtime temp/output file,
    // and not an out-of-scope non-TS target), plus one level of
    // string-derived copies (slices/splits of a read).
    const sourceVars = new Set<string>();
    for (const match of content.matchAll(DIRECT_READ)) {
      const argument = match[2] ?? "";
      if (!REPO_SOURCE_ARG.test(argument)) continue;
      // Shell scripts, env docs, and YAML/JSON config are outside the
      // TS/TSX source contract by scope.
      if (NON_TS_TARGET.test(argument) && !TS_TARGET.test(argument)) continue;
      sourceVars.add(match[1] ?? "");
    }
    for (const match of content.matchAll(
      new RegExp(DERIVED_READ.source, "g")
    )) {
      if (sourceVars.has(match[2] ?? "")) sourceVars.add(match[1] ?? "");
    }

    for (const variable of sourceVars) {
      if (variable.length === 0) continue;
      const pinned =
        LITERAL_PIN_ON(variable).test(content) ||
        SEARCH_PIN_ON(variable).some((pattern) => pattern.test(content));
      if (pinned) {
        violations.push(
          `${path}: literal pins on source variable \`${variable}\``
        );
      }
    }
  }

  return violations.sort();
};
