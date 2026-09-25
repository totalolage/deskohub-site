import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  findViolations,
  listTrackedTestFiles,
} from "./shared/no-source-string-audit";

const repoRoot = resolve(import.meta.dir, "..");
const trackedFiles = listTrackedTestFiles().map((relativePath) => ({
  path: relativePath,
  content: readFileSync(join(repoRoot, relativePath), "utf8"),
}));

describe("no source-as-string contract tests", () => {
  test("tracked tests never pin literal substrings of repository source", () => {
    expect(findViolations(trackedFiles)).toEqual([]);
  });

  test("the audit catches the rejected pattern when it is present", () => {
    // The rejected fixture is assembled from fragments so this tracked test
    // file never contains a literal instance of the audited pattern itself.
    const sourceVar = ["sour", "ce"].join("");
    const legacyPattern = [
      {
        path: "tmp/legacy-source-string.test.ts",
        content: [
          'import { expect, test } from "bun:test";',
          `const ${sourceVar} = await Bun.file(new URL("./layout.tsx", import.meta.url)).text();`,
          'test("pins the layout", () => {',
          `  expect(${sourceVar}).to` + `Contain("export default function");`,
          "});",
        ].join("\n"),
      },
    ];

    expect(findViolations(legacyPattern)).toEqual([
      `tmp/legacy-source-string.test.ts: literal pins on source variable \`${sourceVar}\``,
    ]);
  });

  test("the audit ignores structural verdicts over read sources", () => {
    const structuralVar = ["sour", "ce"].join("");
    const structural = [
      {
        path: "tmp/structural-check.test.ts",
        content: [
          'import { readFileSync } from "node:fs";',
          'import { countOccurrences } from "./shared/source-contract";',
          `const ${structuralVar} = readFileSync("app/layout.tsx", "utf8");`,
          "test(\"counts\", () => {",
          `  expect(countOccurrences(${structuralVar}, "export default")).toBe(1);`,
          `  expect(/export default/.test(${structuralVar})).toBe(true);`,
          "});",
        ].join("\n"),
      },
    ];

    expect(findViolations(structural)).toEqual([]);
  });
});
