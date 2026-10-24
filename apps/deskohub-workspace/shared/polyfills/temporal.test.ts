/**
 * `instrumentation.ts` installs the Temporal polyfill for the running server,
 * but Next loads route modules without it while it collects page data at
 * build time. A module that reads `Temporal` while it loads (a top-level
 * const, a static class field, an immediately invoked function) must import
 * `@/shared/polyfills/temporal` itself, or bind `Temporal` from
 * `@js-temporal/polyfill`, so the build never sees `Temporal is not defined`.
 *
 * Reads through `globalThis`, `window`, `self`, or `global` count as well.
 * Bun ships Temporal, so `*.test.*` modules are exempt. Uses inside function
 * bodies, default parameters, and instance field initializers run later and
 * are exempt too, as are `typeof` probes and a `Temporal` the module binds
 * itself. The scan is per module: it does not follow a load-time call into a
 * function that reads `Temporal`.
 */
import { describe, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { commandOutput } from "@/scripts/shared/command";

const appRoot = resolve(import.meta.dir, "../..");
const polyfillModule = resolve(appRoot, "shared/polyfills/temporal");
const polyfillInstaller = `${polyfillModule}.ts`;

const scannedModule = /(?<!\.d)\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const testModule = /\.test\.[cm]?[jt]sx?$/;

const resolveAppModule = (path: string, specifier: string) => {
  if (specifier.startsWith("@/")) return resolve(appRoot, specifier.slice(2));
  if (specifier.startsWith(".")) {
    return resolve(dirname(resolve(appRoot, path)), specifier);
  }
  return undefined;
};

/** Whether the module is the polyfill installer or imports it for effect. */
const loadsPolyfill = (path: string, source: ts.SourceFile) =>
  resolve(appRoot, path) === polyfillInstaller ||
  source.statements.some((statement) => {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      return false;
    }
    if (statement.importClause !== undefined) return false;
    return (
      resolveAppModule(path, statement.moduleSpecifier.text)?.replace(
        /\.ts$/,
        ""
      ) === polyfillModule
    );
  });

/** Whether the identifier names a declaration or member rather than reading. */
const isNameSlot = (identifier: ts.Identifier) => {
  const parent = identifier.parent;
  return (
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

const isTypeOnly = (reference: ts.Node) => {
  for (let node = reference; node.parent; node = node.parent) {
    if (ts.isTypeNode(node) && !isEvaluatedHeritage(node)) return true;
  }
  return false;
};

/** Wrappers that leave the wrapped value unchanged at runtime. */
const isTransparentWrapper = (
  node: ts.Node
): node is
  | ts.ParenthesizedExpression
  | ts.AssertionExpression
  | ts.SatisfiesExpression
  | ts.NonNullExpression =>
  ts.isParenthesizedExpression(node) ||
  ts.isAssertionExpression(node) ||
  ts.isSatisfiesExpression(node) ||
  ts.isNonNullExpression(node);

const unwrap = (node: ts.Node) => {
  while (isTransparentWrapper(node)) node = node.expression;
  return node;
};

/** The outermost transparent wrapper around `node`, or `node` itself. */
const outermostWrapper = (node: ts.Node) => {
  while (isTransparentWrapper(node.parent)) node = node.parent;
  return node;
};

const globalObjects = new Set(["globalThis", "window", "self", "global"]);

/** `globalThis.Temporal` or `window["Temporal"]` style global access. */
const isGlobalAccess = (
  access: ts.PropertyAccessExpression | ts.ElementAccessExpression
) => {
  const object = unwrap(access.expression);
  return ts.isIdentifier(object) && globalObjects.has(object.text);
};

/** The expression that reads global `Temporal` through `node`, if any. */
const temporalReference = (node: ts.Node): ts.Node | undefined => {
  const parent = node.parent;
  if (ts.isIdentifier(node) && node.text === "Temporal") {
    if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
      return isGlobalAccess(parent) ? parent : undefined;
    }
    return isNameSlot(node) ? undefined : node;
  }
  if (!ts.isStringLiteralLike(node) || node.text !== "Temporal") {
    return undefined;
  }
  const key = outermostWrapper(node);
  if (
    ts.isElementAccessExpression(key.parent) &&
    key.parent.argumentExpression === key &&
    isGlobalAccess(key.parent)
  ) {
    return key.parent;
  }
  return undefined;
};

const isImmediatelyInvoked = (fn: ts.SignatureDeclaration) => {
  const node = outermostWrapper(fn);
  return (
    (ts.isCallExpression(node.parent) || ts.isNewExpression(node.parent)) &&
    node.parent.expression === node
  );
};

/** Whether the code holding `node` runs while its module loads. */
const runsAtLoad = (node: ts.Node) => {
  for (let child = node; child.parent; child = child.parent) {
    const parent = child.parent;
    if (ts.isFunctionLike(parent)) {
      const isBody = "body" in parent && parent.body === child;
      if (
        (isBody ||
          parent.parameters.some((parameter) => parameter === child)) &&
        !isImmediatelyInvoked(parent)
      ) {
        return false;
      }
      // A generator body waits for the first `next()`; its parameters don't.
      if (isBody && "asteriskToken" in parent && parent.asteriskToken) {
        return false;
      }
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

/** Whether the declaration sits under `declare`, so binds nothing at runtime. */
const isAmbient = (declaration: ts.Node) => {
  for (let node: ts.Node | undefined = declaration; node; node = node.parent) {
    if (
      ts.canHaveModifiers(node) &&
      ts
        .getModifiers(node)
        ?.some(({ kind }) => kind === ts.SyntaxKind.DeclareKeyword)
    ) {
      return true;
    }
  }
  return false;
};

/**
 * Whether a bare `Temporal` resolves to a binding the module declares, such
 * as a local const or an import, rather than the global. Without the default
 * library, the global `Temporal` resolves to no symbol. Type-only imports and
 * `declare`d names create no runtime binding.
 */
const bindsLocally = (source: ts.SourceFile) => {
  const options: ts.CompilerOptions = {
    allowJs: true,
    noLib: true,
    noResolve: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (fileName) =>
    fileName === source.fileName ? source : undefined;
  const checker = ts
    .createProgram({ rootNames: [source.fileName], options, host })
    .getTypeChecker();
  return (identifier: ts.Identifier) => {
    const symbol = ts.isShorthandPropertyAssignment(identifier.parent)
      ? checker.getShorthandAssignmentValueSymbol(identifier.parent)
      : checker.getSymbolAtLocation(identifier);
    return (
      symbol?.declarations?.some(
        (declaration) =>
          !ts.isTypeOnlyImportDeclaration(declaration) &&
          !isAmbient(declaration)
      ) === true
    );
  };
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
  if (loadsPolyfill(path, source)) return [];
  const references: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    const reference = temporalReference(node);
    if (
      reference !== undefined &&
      !ts.isTypeOfExpression(outermostWrapper(reference).parent) &&
      !isTypeOnly(reference) &&
      runsAtLoad(reference)
    ) {
      references.push(reference);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (references.length === 0) return [];
  const isLocal = bindsLocally(source);
  return references
    .filter((reference) => !(ts.isIdentifier(reference) && isLocal(reference)))
    .map((reference) => {
      const { line, character } = source.getLineAndCharacterOfPosition(
        reference.getStart(source)
      );
      return `${line + 1}:${character + 1}`;
    });
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
      "a module that imports a Temporal type from another module",
      'import { type Temporal } from "./clock";\nconst step = Temporal.Duration.from({ hours: 1 });',
    ],
    [
      "a module that renames the polyfill binding",
      'import { Temporal as Polyfill } from "@js-temporal/polyfill";\nconst step = Temporal.Duration.from({ hours: 1 });',
    ],
    [
      "a global read in a module that binds the polyfill package",
      'import { Temporal } from "@js-temporal/polyfill";\nconst now = globalThis.Temporal.Now.instant();',
    ],
    [
      "an ambient Temporal declaration",
      "declare const Temporal: any;\nconst now = Temporal.Now.instant();",
    ],
    [
      "an immediately invoked generator's default parameter",
      "const steps = (function* (now = Temporal.Now.instant()) { yield now; })();",
    ],
    [
      "an immediately constructed function",
      "new (function () { Temporal.Now.instant(); })();",
    ],
    ["a globalThis read", "const now = globalThis.Temporal.Now.instant();"],
    ["a window read", "const now = window.Temporal.Now.instant();"],
    ["a self read", "const now = self.Temporal.Now.instant();"],
    ["a global read", "const now = global.Temporal.Now.instant();"],
    [
      "a global element read",
      'const now = globalThis["Temporal"].Now.instant();',
    ],
    [
      "a global read behind an assertion",
      "const now = (globalThis as typeof globalThis).Temporal.Now.instant();",
    ],
    [
      "a global element read behind parentheses",
      'const now = globalThis[("Temporal")].Now.instant();',
    ],
    [
      "a global element read behind an assertion",
      'const now = globalThis["Temporal" as const].Now.instant();',
    ],
    [
      "a global element read with a template key",
      "const now = globalThis[`Temporal`].Now.instant();",
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
      "a typeof probe on a global",
      'export const native = typeof globalThis.Temporal === "undefined" || typeof window["Temporal"] === "undefined";',
    ],
    [
      "a parenthesized typeof probe",
      'export const native = typeof (globalThis.Temporal) === "undefined";',
    ],
    [
      "an immediately invoked generator",
      "const steps = (function* () { yield Temporal.Now.instant(); })();",
    ],
    [
      "a global read in a function body",
      "export const later = () => globalThis.Temporal.Now.instant();",
    ],
    [
      "a Temporal property of another object",
      "export const now = clock.Temporal.Now.instant();",
    ],
    [
      "a local Temporal binding",
      "const Temporal = clock;\nexport const now = Temporal.Now.instant();",
    ],
    [
      "a Temporal binding imported from another module",
      'import { Temporal } from "./clock";\nexport const now = Temporal.Now.instant();',
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

  const globalRead = "const now = Temporal.Now.instant();";

  test("exempts only the polyfill installer itself", () => {
    expect(
      findLoadTimeTemporalReads("shared/polyfills/temporal.ts", globalRead)
    ).toEqual([]);
  });

  test.each(["shared/polyfills/temporal.tsx", "shared/polyfills/temporal.mts"])(
    "checks the installer's sibling %s",
    (path) => {
      expect(findLoadTimeTemporalReads(path, globalRead)).not.toEqual([]);
    }
  );

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
