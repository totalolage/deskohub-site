import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  findViolations,
  listTrackedTestFiles,
  repositoryRoot,
} from "./shared/no-source-string-audit";
import { countTokenSequence, sourceTokens } from "./shared/source-contract";

const repoRoot = repositoryRoot();
const trackedFiles = listTrackedTestFiles().map((relativePath) => ({
  path: relativePath,
  content: readFileSync(join(repoRoot, relativePath), "utf8"),
}));

describe("no source-as-string contract tests", () => {
  test("tracked tests never pin literal substrings of repository source", () => {
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
    ];

    expect(
      findViolations(fixtures).map((violation) => violation.split(":")[0])
    ).toEqual(fixtures.map((fixture) => fixture.path).sort());
  });

  test("the tokenizer keeps spread ellipses as single tokens", () => {
    // Fixture for the raw-env-spread policy: an ellipsis must tokenize as one
    // token so `...process.env` spreads are detectable as a token sequence.
    const ellipsis = ["..", "."].join("");
    const snippet = [
      "const env = {",
      ellipsis,
      "process",
      ".",
      "env",
      "};",
    ].join(" ");
    const sequence = [ellipsis, "process", ".", "env"];

    expect(countTokenSequence(sourceTokens(snippet), sequence)).toBe(1);
  });

  test("the audit ignores structural verdicts over read sources", () => {
    const structuralVar = ["sour", "ce"].join("");
    const structural = [
      {
        path: "tmp/structural-check.test.ts",
        content: [
          'import { readFileSync } from "node:fs";',
          'import { extractImportSpecifiers, extractStringLiterals } from "./shared/source-contract";',
          `const ${structuralVar} = readFileSync("app/layout.tsx", "utf8");`,
          'test("extracts structure", () => {',
          `  expect(extractImportSpecifiers(${structuralVar})).toContain("react");`,
          `  expect(extractStringLiterals(${structuralVar})).toContain("app/layout");`,
          "});",
        ].join("\n"),
      },
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
});
