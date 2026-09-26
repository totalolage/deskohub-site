import { describe, expect, test } from "bun:test";
import type { TSESTree } from "@typescript-eslint/types";
import {
  awaitedCallsInOrder,
  callsNamed,
  containsNode,
  exportedNames,
  identifierNames,
  importSpecifiers,
  methodCallsNamed,
  parseSource,
  parseTrackedSource,
  positionDelta,
  propertyAssignments,
  stringArguments,
  stringLiterals,
  topLevelConstInitializer,
} from "./source-ast";

const fixturePath = new URL("./source-ast.test-fixture.ts", import.meta.url)
  .pathname;

describe("source-ast structured checks", () => {
  test("finds calls regardless of formatting", () => {
    const ast = parseSource(
      [
        "const spaced =  await  captureAccountReview( page , target ) ;",
        "const tight = await captureAccountReview(page,target);",
      ].join("\n")
    );
    expect(callsNamed(ast, "captureAccountReview")).toHaveLength(2);
  });

  test("a commented-out call never satisfies a presence check", () => {
    const ast = parseSource(
      [
        "// const gone = await captureAccountReview(page, target);",
        "/* const blocked = await captureAccountReview(page, target); */",
        "const real = await captureAccountReview(page, target);",
      ].join("\n")
    );
    expect(callsNamed(ast, "captureAccountReview")).toHaveLength(1);
    // The rejected string-scanning pattern satisfied presence from comment
    // text; the AST verdict counts only active code.
    const commentOnly = parseSource(
      "// const ghost = await captureAccountReview(page, target);"
    );
    expect(callsNamed(commentOnly, "captureAccountReview")).toHaveLength(0);
  });

  test("reordered awaited calls fail a source-order assertion", () => {
    const ordered = parseSource(
      ["await remove(invoiceEmailDeliveries);", "await remove(invoices);"].join(
        "\n"
      )
    );
    const unordered = parseSource(
      ["await remove(invoices);", "await remove(invoiceEmailDeliveries);"].join(
        "\n"
      )
    );
    const orderedDeletes = awaitedCallsInOrder(ordered, "remove");
    expect(positionDelta(orderedDeletes[0]!, orderedDeletes[1]!)).toBeLessThan(
      0
    );
    const unorderedDeletes = awaitedCallsInOrder(unordered, "remove");
    const argumentName = (call: (typeof unorderedDeletes)[number]): string =>
      call.arguments[0]?.type === "Identifier" ? call.arguments[0].name : "";
    const deliveries = unorderedDeletes.find(
      (call) => argumentName(call) === "invoiceEmailDeliveries"
    )!;
    const invoices = unorderedDeletes.find(
      (call) => argumentName(call) === "invoices"
    )!;
    // The required contract order (deliveries before invoices) fails loudly.
    expect(positionDelta(deliveries, invoices)).toBeGreaterThan(0);
  });

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

  test("object property and literal verdicts are key-based, not position-based", () => {
    const ast = parseSource(
      [
        "const mapping = {",
        "  profile: undefined,",
        '  reservations: "linked-reservations-mobile",',
        "};",
      ].join("\n")
    );
    const initializer = topLevelConstInitializer(ast, "mapping");
    expect(initializer?.type).toBe("ObjectExpression");
    const properties = propertyAssignments(
      initializer as TSESTree.ObjectExpression
    );
    expect(properties.has("profile")).toBe(true);
    expect(properties.has("reservations")).toBe(true);
    expect(properties.has("legal")).toBe(false);
  });

  test("method calls, string arguments, imports, and exports resolve", () => {
    const ast = parseSource(
      [
        'import { Effect } from "effect";',
        'import "./side-effect";',
        'export const site = { domain: "workspace.deskohub.cz" };',
        'const stripped = script.replace("GITHUB_OUTPUT", "");',
        "if (missing.length > 0) process.stdout.write(stripped);",
      ].join("\n")
    );
    expect(importSpecifiers(ast)).toEqual(["effect", "./side-effect"]);
    expect(exportedNames(ast)).toEqual(["site"]);
    expect(methodCallsNamed(ast, "replace")).toHaveLength(1);
    expect(stringArguments(methodCallsNamed(ast, "replace")[0]!)).toEqual([
      "GITHUB_OUTPUT",
      "",
    ]);
    expect(stringLiterals(ast).map((literal) => literal.value)).toContain(
      "workspace.deskohub.cz"
    );
    expect(identifierNames(ast).has("process")).toBe(true);
    expect(identifierNames(ast).has("stdout")).toBe(true);
  });

  test("parses a real tracked module with the same verdicts", () => {
    const { ast } = parseTrackedSource(fixturePath);
    expect(callsNamed(ast, "captureAccountReview")).toHaveLength(2);
    const captures = awaitedCallsInOrder(ast, "captureAccountReview");
    expect(positionDelta(captures[0]!, captures[1]!)).toBeLessThan(0);
  });

  test("a renamed callee breaks the check instead of matching stale text", () => {
    // The rejected substring pattern kept matching after the call site was
    // renamed away from the contract; the AST verdict fails loudly instead.
    const ast = parseSource(
      "const renamed = await captureAccountSnapshot(page, target);"
    );
    expect(callsNamed(ast, "captureAccountReview")).toHaveLength(0);
  });
});
