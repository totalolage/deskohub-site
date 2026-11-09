import { describe, expect, test } from "bun:test";
import {
  callsNamed,
  containsNode,
  identifierNames,
  methodCallsNamed,
  parseSource,
  stringLiterals,
  topLevelConstInitializer,
} from "./source-ast";

describe("source-ast structured checks", () => {
  test("containment scopes verdicts to one block, not sibling code", () => {
    const ast = parseSource(
      [
        "const outer = () => {",
        "  await captureAccountReview(page, desktop);",
        "  if (mobileTarget) {",
        "    await captureAccountReview(page, mobile);",
        "  }",
        "};",
        "const sibling = () => {",
        "  await captureAccountReview(page, elsewhere);",
        "};",
      ].join("\n")
    );
    const outerInitializer = topLevelConstInitializer(ast, "outer");
    expect(outerInitializer).toBeDefined();
    const insideOuter = callsNamed(outerInitializer!, "captureAccountReview");
    expect(insideOuter).toHaveLength(2);
    const wholeFile = callsNamed(ast, "captureAccountReview");
    expect(wholeFile).toHaveLength(3);
    for (const call of insideOuter) {
      expect(containsNode(outerInitializer!, call)).toBe(true);
    }
  });

  test("method calls, string literals, and identifiers resolve", () => {
    const ast = parseSource(
      [
        'import { Effect } from "effect";',
        'import "./side-effect";',
        'export const site = { domain: "workspace.deskohub.cz" };',
        'const stripped = script.replace("GITHUB_OUTPUT", "");',
        "if (missing.length > 0) process.stdout.write(stripped);",
      ].join("\n")
    );
    expect(methodCallsNamed(ast, "replace")).toHaveLength(1);
    expect(stringLiterals(ast).map((literal) => literal.value)).toContain(
      "workspace.deskohub.cz"
    );
    expect(identifierNames(ast).has("process")).toBe(true);
    expect(identifierNames(ast).has("stdout")).toBe(true);
  });
});
