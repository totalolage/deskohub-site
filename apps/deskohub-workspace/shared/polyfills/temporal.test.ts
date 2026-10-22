/**
 * `instrumentation.ts` installs the Temporal polyfill for the running server,
 * but Next loads route modules without it while it collects page data at
 * build time. A module that reads `Temporal` while it loads (a top-level
 * const, a static class field, an immediately invoked function) must import
 * `@/shared/polyfills/temporal` itself, or bind `Temporal` from
 * `@js-temporal/polyfill`, so the build never sees `Temporal is not defined`.
 *
 * Bun ships Temporal, so `*.test.*` modules are exempt. Uses inside function
 * bodies, default parameters, and instance field initializers run later and
 * are exempt too. The scan is syntactic: it does not follow a load-time call
 * into a function that reads `Temporal`.
 */
import { describe, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { commandOutput } from "@/scripts/shared/command";

const appRoot = resolve(import.meta.dir, "../..");
const polyfillModule = resolve(appRoot, "shared/polyfills/temporal");

const scannedModule = /(?<!\.d)\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const testModule = /\.test\.[cm]?[jt]sx?$/;

const resolveAppModule = (path: string, specifier: string) => {
  if (specifier.startsWith("@/")) return resolve(appRoot, specifier.slice(2));
  if (specifier.startsWith(".")) {
    return resolve(dirname(resolve(appRoot, path)), specifier);
  }
  return undefined;
};

const importsPolyfill = (path: string, source: ts.SourceFile) =>
  source.statements.some((statement) => {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      return false;
    }
    const specifier = statement.moduleSpecifier.text;
    if (specifier === "@js-temporal/polyfill") {
      const clause = statement.importClause;
      const bindings = clause?.namedBindings;
      return (
        clause?.isTypeOnly === false &&
        bindings !== undefined &&
        ts.isNamedImports(bindings) &&
        bindings.elements.some(
          ({ isTypeOnly, name, propertyName }) =>
            !isTypeOnly &&
            name.text === "Temporal" &&
            (propertyName ?? name).text === "Temporal"
        )
      );
    }
    if (statement.importClause !== undefined) return false;
    return (
      resolveAppModule(path, specifier)?.replace(/\.ts$/, "") === polyfillModule
    );
  });

/** Whether the identifier is a name slot or a `typeof` probe, not a read. */
const isNameSlot = (identifier: ts.Identifier) => {
  const parent = identifier.parent;
  return (
    ts.isTypeOfExpression(parent) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === identifier) ||
    ts.isQualifiedName(parent) ||
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    (ts.isPropertyAssignment(parent) && parent.name === identifier) ||
    (ts.isJsxAttribute(parent) && parent.name === identifier) ||
    ((ts.isDeclarationStatement(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent) ||
      ts.isEnumMember(parent) ||
      ts.isClassElement(parent) ||
      ts.isTypeElement(parent)) &&
      ts.getNameOfDeclaration(parent) === identifier)
  );
};

/** `class X extends Temporal.Y` evaluates its heritage expression. */
const isEvaluatedHeritage = (node: ts.Node) =>
  ts.isExpressionWithTypeArguments(node) &&
  ts.isHeritageClause(node.parent) &&
  node.parent.token === ts.SyntaxKind.ExtendsKeyword &&
  ts.isClassLike(node.parent.parent);

const isTypeOnly = (identifier: ts.Identifier) => {
  for (let node: ts.Node = identifier; node.parent; node = node.parent) {
    if (ts.isTypeNode(node) && !isEvaluatedHeritage(node)) return true;
  }
  return false;
};

/** Wrappers that leave the wrapped value unchanged at runtime. */
const isTransparentWrapper = (node: ts.Node) =>
  ts.isParenthesizedExpression(node) ||
  ts.isAssertionExpression(node) ||
  ts.isSatisfiesExpression(node) ||
  ts.isNonNullExpression(node);

const isImmediatelyInvoked = (fn: ts.SignatureDeclaration) => {
  let node: ts.Node = fn;
  while (isTransparentWrapper(node.parent)) node = node.parent;
  return ts.isCallExpression(node.parent) && node.parent.expression === node;
};

/** Whether the code holding `node` runs while its module loads. */
const runsAtLoad = (node: ts.Node) => {
  for (let child = node; child.parent; child = child.parent) {
    const parent = child.parent;
    if (
      ts.isFunctionLike(parent) &&
      !isImmediatelyInvoked(parent) &&
      (("body" in parent && parent.body === child) ||
        parent.parameters.some((parameter) => parameter === child))
    ) {
      return false;
    }
    if (
      ts.isPropertyDeclaration(parent) &&
      parent.initializer === child &&
      !ts.hasStaticModifier(parent)
    ) {
      return false;
    }
  }
  return true;
};

/** 1-based `line:column` of each load-time `Temporal` reference. */
const findLoadTimeTemporalReads = (
  path: string,
  sourceText: string
): string[] => {
  if (!sourceText.includes("Temporal")) return [];
  const source = ts.createSourceFile(
    path,
    sourceText,
    ts.ScriptTarget.Latest,
    true
  );
  if (importsPolyfill(path, source)) return [];
  const reads: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isIdentifier(node) &&
      node.text === "Temporal" &&
      !isNameSlot(node) &&
      !isTypeOnly(node) &&
      runsAtLoad(node)
    ) {
      const { line, character } = source.getLineAndCharacterOfPosition(
        node.getStart(source)
      );
      reads.push(`${line + 1}:${character + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return reads;
};

describe("load-time Temporal reads", () => {
  const readsIn = (sourceText: string) =>
    findLoadTimeTemporalReads("features/example/example.ts", sourceText);

  test.each([
    ["a top-level const", "const step = Temporal.Duration.from({ hours: 1 });"],
    [
      "a static class field",
      "class Window { static span = Temporal.Duration.from({ hours: 1 }); }",
    ],
    ["a static block", "class Window { static { Temporal.Now.instant(); } }"],
    [
      "an immediately invoked function",
      "const now = (() => Temporal.Now.instant())();",
    ],
    ["a heritage expression", "class Day extends Temporal.PlainDate {}"],
    [
      "an immediately invoked function behind an assertion",
      "const now = ((() => Temporal.Now.instant()) satisfies () => unknown)();",
    ],
    ["a shorthand property", "export const clock = { Temporal };"],
    [
      "a module that imports Temporal only as a type",
      'import type { Temporal } from "@js-temporal/polyfill";\nconst step = Temporal.Duration.from({ hours: 1 });',
    ],
    [
      "a module that renames the polyfill binding",
      'import { Temporal as Polyfill } from "@js-temporal/polyfill";\nconst step = Temporal.Duration.from({ hours: 1 });',
    ],
  ])("rejects %s", (_case, sourceText) => {
    expect(readsIn(sourceText)).not.toEqual([]);
  });

  test.each([
    ["a function body", "export const later = () => Temporal.Now.instant();"],
    [
      "a default parameter",
      "export function at(now = Temporal.Now.instant()) { return now; }",
    ],
    [
      "an instance field",
      "export class Clock { now = Temporal.Now.instant(); }",
    ],
    [
      "a method",
      "export class Clock { now() { return Temporal.Now.instant(); } }",
    ],
    [
      "a type",
      "export type Window = { readonly endsAt: Temporal.Instant }; let at: typeof Temporal.Now;",
    ],
    [
      "a typeof probe",
      'export const native = typeof Temporal !== "undefined";',
    ],
    [
      "declaration names",
      "const { Temporal } = clock; enum Clock { Temporal }",
    ],
    [
      "a module that loads the shared polyfill",
      'import "@/shared/polyfills/temporal";\nconst step = Temporal.Duration.from({ hours: 1 });',
    ],
    [
      "a module that loads the polyfill by relative path",
      'import "../../shared/polyfills/temporal";\nconst step = Temporal.Duration.from({ hours: 1 });',
    ],
    [
      "a module that binds Temporal from the polyfill package",
      'import { Temporal } from "@js-temporal/polyfill";\nconst step = Temporal.Duration.from({ hours: 1 });',
    ],
  ])("permits %s", (_case, sourceText) => {
    expect(readsIn(sourceText)).toEqual([]);
  });

  test("every Workspace module that reads Temporal while loading imports the polyfill", async () => {
    const listing = await commandOutput(
      ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { cwd: appRoot }
    );
    const paths = listing
      .split("\0")
      .filter((path) => scannedModule.test(path) && !testModule.test(path));

    const findings: string[] = [];
    for (const path of paths) {
      const sourceText = await Bun.file(resolve(appRoot, path)).text();
      for (const position of findLoadTimeTemporalReads(path, sourceText)) {
        findings.push(`${path}:${position}`);
      }
    }

    expect(paths.length).toBeGreaterThan(0);
    expect(findings).toEqual([]);
  });
});
