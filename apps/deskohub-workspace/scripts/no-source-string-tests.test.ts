import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  findViolations,
  listTrackedTestFiles,
  repositoryRoot,
} from "./shared/no-source-string-audit";
import {
  callsNamed,
  parseSource,
  parseTrackedSource,
} from "./shared/source-ast";

const repoRoot = repositoryRoot();
const trackedFiles = listTrackedTestFiles().map((relativePath) => ({
  path: relativePath,
  content: readFileSync(join(repoRoot, relativePath), "utf8"),
}));

describe("no source-as-string contract tests", () => {
  test("tracked tests never pin literal substrings of repository TS/TSX source", () => {
    expect(findViolations(trackedFiles)).toEqual([]);
  });

  test("the enumeration is repository-wide, not app-scoped", () => {
    const tracked = listTrackedTestFiles();
    // Every path is resolved from the repository root.
    expect(tracked.length).toBeGreaterThan(0);
    expect(tracked).toContain("apps/dhw/src/command.test.ts");
    expect(tracked).toContain("packages/games/src/generate.test.ts");
    // Tests from other apps and packages are part of the audited set.
    expect(
      tracked.some((path) => !path.startsWith("apps/deskohub-workspace/"))
    ).toBe(true);
    expect(
      tracked.some((path) => path.startsWith("apps/deskohub-boardgame-bar/"))
    ).toBe(true);
    expect(tracked.some((path) => path.startsWith("packages/"))).toBe(true);
    // The audit verdict itself runs over the full repository set.
    expect(findViolations(trackedFiles)).toEqual([]);
  });

  test("the audit catches the rejected pattern when it is present", () => {
    // The rejected fixtures are assembled from fragments so this tracked test
    // file never contains a literal instance of the audited patterns itself.
    const sourceVar = ["sour", "ce"].join("");
    const toContain = ["to", "Contain"].join("");
    const toBe = ["to", "Be"].join("");
    const includes = ["incl", "udes"].join("");
    const indexOf = ["index", "Of"].join("");
    const testFn = ["te", "st"].join("");
    const regExp = ["Reg", "Exp"].join("");
    const countOccurrencesName = ["count", "Occurrences"].join("");
    const readTrackedSourceName = ["readTracked", "Source"].join("");
    const toMatch = ["to", "Match"].join("");
    const regexLiteral = ["/export default", "/"].join("");
    const newRegExp = ["new ", regExp, "("].join("");

    const legacyRead = `const ${sourceVar} = await Bun.file(new URL("./layout.tsx", import.meta.url)).text();`;
    const wrapperRead = `const ${sourceVar} = ${readTrackedSourceName}(new URL("./layout.tsx", import.meta.url).pathname);`;

    const fixtures = [
      {
        path: "tmp/legacy-source-string.test.ts",
        content: [
          'import { expect, test } from "bun:test";',
          legacyRead,
          'test("pins the layout", () => {',
          `  expect(${sourceVar}).${toContain}("export default function");`,
          "});",
        ].join("\n"),
      },
      {
        path: "tmp/regex-argument.test.ts",
        content: [
          'import { expect, test } from "bun:test";',
          legacyRead,
          'test("pins via matcher regex", () => {',
          `  expect(${sourceVar}).${toMatch}(${regexLiteral});`,
          `  expect(${sourceVar}).not.${toMatch}(${newRegExp}"export default"));`,
          "});",
        ].join("\n"),
      },
      {
        path: "tmp/includes-boolean.test.ts",
        content: [
          'import { expect, test } from "bun:test";',
          legacyRead,
          'test("pins via includes", () => {',
          `  expect(${sourceVar}.${includes}("export default function")).${toBe}(true);`,
          `  expect(${sourceVar}.${includes}("export default function")).${toBe}(false);`,
          `  expect(${sourceVar}.${indexOf}("export default")).${toBe}(-1);`,
          "});",
        ].join("\n"),
      },
      {
        path: "tmp/regex-matcher.test.ts",
        content: [
          'import { expect, test } from "bun:test";',
          legacyRead,
          'test("pins via regex", () => {',
          `  expect(new ${regExp}("export default").${testFn}(${sourceVar})).${toBe}(true);`,
          "});",
        ].join("\n"),
      },
      {
        path: "tmp/count-occurrences.test.ts",
        content: [
          'import { expect, test } from "bun:test";',
          legacyRead,
          'test("pins via counts", () => {',
          `  expect(${countOccurrencesName}(${sourceVar}, "export default")).${toBe}(1);`,
          "});",
        ].join("\n"),
      },
      {
        path: "tmp/wrapper-read.test.ts",
        content: [
          'import { expect, test } from "bun:test";',
          `import { ${readTrackedSourceName} } from "./shared/source-contract";`,
          wrapperRead,
          'test("pins through the wrapper", () => {',
          `  expect(${sourceVar}).${toContain}("export default function");`,
          "});",
        ].join("\n"),
      },
      // The retired allowlist must never come back: these are real tracked
      // policy files whose conversions replaced their scanner entries. A
      // regression in any of them must fail the audit, not be allowlisted.
      {
        path: "tmp/regression-scanner.test.ts",
        content: [
          'import { expect, test } from "bun:test";',
          'import { readFileSync } from "node:fs";',
          'import { resolve } from "node:path";',
          `const lane = readFileSync(resolve(import.meta.dir, "../e2e/account/account-lane.pw.ts"), "utf8");`,
          'test("reintroduces the scanner", () => {',
          `  expect(lane.${includes}('mode: "serial"')).${toBe}(true);`,
          "});",
        ].join("\n"),
      },
    ];

    expect(
      findViolations(fixtures).map((violation) => violation.split(":")[0])
    ).toEqual(fixtures.map((fixture) => fixture.path).sort());
  });

  test("reads of out-of-scope non-TS targets are outside the source contract", () => {
    // Shell scripts, env docs, and YAML/JSON config are excluded by scope,
    // not by per-file allowlist entries.
    const shellVar = ["scri", "pt"].join("");
    const envVar = ["envExam", "ple"].join("");
    const occurrencesName = ["count", "Occurrences"].join("");
    const toBe = ["to", "Be"].join("");

    const fixtures = [
      {
        path: "tmp/shell-script-contract.test.ts",
        content: [
          'import { expect, test } from "bun:test";',
          'import { readFileSync } from "node:fs";',
          'import { fileURLToPath } from "node:url";',
          `const ${shellVar} = readFileSync(fileURLToPath(new URL("./generate.sh", import.meta.url)), "utf8");`,
          'test("pins the shell", () => {',
          `  expect(${occurrencesName}(${shellVar}, "set -e")).${toBe}(1);`,
          "});",
        ].join("\n"),
      },
      {
        path: "tmp/env-doc-contract.test.ts",
        content: [
          'import { expect, test } from "bun:test";',
          `const ${envVar} = await Bun.file(new URL("../.env.example", import.meta.url)).text();`,
          'test("pins the env doc", () => {',
          `  expect(${occurrencesName}(${envVar}, "SECRET=")).${toBe}(1);`,
          "});",
        ].join("\n"),
      },
    ];

    expect(findViolations(fixtures)).toEqual([]);
  });

  test("the audit ignores structural verdicts over read sources", () => {
    const structuralVar = ["sour", "ce"].join("");
    const structural = [
      {
        path: "tmp/runtime-output-check.test.ts",
        content: [
          'import { expect, test } from "bun:test";',
          `const ${structuralVar} = await Bun.file(outputFile).text();`,
          `expect(${structuralVar}).toContain("generated contract");`,
        ].join("\n"),
      },
    ];

    expect(findViolations(structural)).toEqual([]);
  });

  test("the audit resolves tracked files relative to the repository root", () => {
    const root = repositoryRoot();
    const tracked = listTrackedTestFiles();
    for (const relativePath of tracked.slice(0, 25)) {
      expect(() =>
        readFileSync(resolve(root, relativePath), "utf8")
      ).not.toThrow();
    }
  });

  test("the replacement AST verdicts are comment- and formatting-immune", () => {
    // A commented-out call satisfies nothing in the parsed tree...
    const commented = parseSource(
      "// await captureAccountReview(page, target);"
    );
    expect(callsNamed(commented, "captureAccountReview")).toHaveLength(0);
    // ...while active code satisfies it under any formatting...
    const spaced = parseSource(
      "await  captureAccountReview( page , target ) ;"
    );
    expect(callsNamed(spaced, "captureAccountReview")).toHaveLength(1);
    // ...and a real tracked module parses with ranges for order verdicts.
    const { ast } = parseTrackedSource(
      resolve(import.meta.dir, "./shared/source-ast.test-fixture.ts")
    );
    expect(callsNamed(ast, "captureAccountReview")).toHaveLength(2);
  });
});
