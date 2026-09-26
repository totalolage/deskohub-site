import { describe, expect, test } from "bun:test";
import type { TSESTree } from "@typescript-eslint/types";
import {
  awaitedCallsInOrder,
  importSpecifiers,
  nodesOf,
  parseTrackedSource,
  stringLiterals,
} from "@/scripts/shared/source-ast";

const parsePageModule = () =>
  parseTrackedSource(new URL("./page.tsx", import.meta.url).pathname);

/** The `<Suspense>` fallback element of the page, if present. */
const suspenseElement = (
  ast: TSESTree.Program
): TSESTree.JSXElement | undefined =>
  nodesOf(ast).find(
    (node): node is TSESTree.JSXElement =>
      node.type === "JSXElement" &&
      node.openingElement.name.type === "JSXIdentifier" &&
      node.openingElement.name.name === "Suspense"
  );

describe("access codes admin route boundary", () => {
  test("renders the form through the cached administration page boundary", () => {
    const { ast } = parsePageModule();

    expect(awaitedCallsInOrder(ast, "authorizeAdministratorPage")).toHaveLength(
      1
    );
    expect(suspenseElement(ast)).toBeDefined();
    const imports = importSpecifiers(ast);
    expect(imports).not.toContain("requireDiscountAdminAuthorization");
    expect(imports.some((specifier) => specifier.includes("basic-auth"))).toBe(
      false
    );
    expect(
      imports.some((specifier) => specifier.includes("ADMIN_BASIC_AUTH_SHA256"))
    ).toBe(false);
  });

  test("keeps the streamed card in the local suspense boundary", () => {
    const { ast } = parsePageModule();

    const pageIdentifiers = new Set(
      nodesOf(ast)
        .filter(
          (node): node is TSESTree.JSXIdentifier =>
            node.type === "JSXIdentifier"
        )
        .map((node) => node.name)
    );
    expect(pageIdentifiers.has("AuthorizedAccessCodeCard")).toBe(true);
    expect(
      nodesOf(ast).some(
        (node) =>
          node.type === "ExportDefaultDeclaration" &&
          node.declaration.type === "FunctionDeclaration" &&
          node.declaration.async
      )
    ).toBe(false);
  });

  test("matches the authorization fallback width to the completed card", () => {
    const { ast } = parsePageModule();

    const fallback = suspenseElement(ast);
    expect(fallback).toBeDefined();
    const literalValues = stringLiterals(ast).map((literal) => literal.value);
    expect(
      stringLiterals(fallback!).some((literal) => literal.value === "max-w-3xl")
    ).toBe(true);
    expect(
      literalValues.some((value) => value.startsWith("max-w-3xl rounded-xl"))
    ).toBe(true);
  });
});
