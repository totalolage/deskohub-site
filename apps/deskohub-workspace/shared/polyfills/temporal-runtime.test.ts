import { describe, expect, mock, test } from "bun:test";
import { relative, resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { Temporal as PolyfillTemporal } from "@js-temporal/polyfill";
import ts from "typescript";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { buildTemporalPolyfill } from "./build-temporal-polyfill";
import {
  isTemporalComplete,
  requiredTemporalApis,
  type TemporalApis,
} from "./temporal-runtime";

const appRoot = resolve(import.meta.dir, "../..");
const { timeZone } = workspaceSiteConstants.location;

type TemporalNamespace = keyof typeof requiredTemporalApis;
/** A Temporal global as a browser may ship it: missing, partial, or whole. */
type TemporalCandidate =
  | {
      readonly [Namespace in TemporalNamespace]?: Partial<
        (typeof PolyfillTemporal)[Namespace]
      >;
    }
  | undefined;

const isComplete = (temporal: TemporalCandidate) =>
  isTemporalComplete(temporal, requiredTemporalApis, timeZone);

/** The polyfill with one namespace replaced. */
const withNamespace = <Namespace extends TemporalNamespace>(
  namespace: Namespace,
  replacement: Partial<(typeof PolyfillTemporal)[Namespace]>
): TemporalCandidate => ({
  ...Object.fromEntries(
    Object.keys(requiredTemporalApis).map((key) => [
      key,
      PolyfillTemporal[key as TemporalNamespace],
    ])
  ),
  [namespace]: replacement,
});

/** The polyfill with one instance member missing from a class's prototype. */
const withoutInstanceMember = (
  namespace: Exclude<TemporalNamespace, "Now">,
  member: string
): TemporalCandidate => {
  const temporalClass = PolyfillTemporal[namespace];
  const { [member]: _missing, ...members } = Object.getOwnPropertyDescriptors(
    temporalClass.prototype
  );
  return withNamespace(
    namespace,
    Object.defineProperties(
      {},
      {
        ...Object.getOwnPropertyDescriptors(temporalClass),
        prototype: {
          value: Object.create(
            Object.getPrototypeOf(temporalClass.prototype),
            members
          ),
        },
      }
    )
  );
};

/** A Temporal that keeps every static entry point but lacks a method. */
const withoutInstanceMethod = withoutInstanceMember(
  "ZonedDateTime",
  "toPlainDateTime"
);

/** Every API in `apis`, as `PlainDate.from` or `PlainDate.prototype.add`. */
const listTemporalApis = (apis: TemporalApis) =>
  Object.entries(apis).flatMap(([namespace, members]) => [
    ...(members.static ?? []).map((member) => `${namespace}.${member}`),
    ...(members.prototype ?? []).map(
      (member) => `${namespace}.prototype.${member}`
    ),
  ]);

/** Whether `node` is the body of the `Temporal` namespace a declaration file declares. */
const isTemporalNamespace = (node: ts.Node): node is ts.ModuleBlock =>
  ts.isModuleBlock(node) &&
  node.parent.name.text === "Temporal" &&
  ts.isSourceFile(node.parent.parent);

/**
 * `PlainDate.` for a static member of a Temporal declaration and
 * `PlainDate.prototype.` for an instance member, in both the TypeScript lib's
 * declaration style and the polyfill's.
 */
const temporalApiPrefix = (member: ts.Declaration) => {
  const owner = member.parent;
  const scope = owner.parent;
  // `class PlainDate { static from(); add() }`
  if (
    ts.isClassDeclaration(owner) &&
    owner.name &&
    isTemporalNamespace(scope)
  ) {
    return ts.canHaveModifiers(member) && ts.hasStaticModifier(member)
      ? `${owner.name.text}.`
      : `${owner.name.text}.prototype.`;
  }
  // `namespace Now { function instant() }`
  if (ts.isModuleBlock(owner) && isTemporalNamespace(owner.parent.parent)) {
    return `${owner.parent.name.text}.`;
  }
  // `const Now: { instant() }`
  if (
    ts.isTypeLiteralNode(owner) &&
    ts.isVariableDeclaration(scope) &&
    ts.isIdentifier(scope.name) &&
    isTemporalNamespace(scope.parent.parent.parent)
  ) {
    return `${scope.name.text}.`;
  }
  // `interface PlainDate { add() }` and `interface PlainDateConstructor
  // { from() }`, with `var PlainDate: PlainDateConstructor`
  if (ts.isInterfaceDeclaration(owner) && isTemporalNamespace(scope)) {
    for (const statement of scope.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const { name, type } of statement.declarationList.declarations) {
        if (!ts.isIdentifier(name)) continue;
        if (name.text === owner.name.text) return `${name.text}.prototype.`;
        if (
          type !== undefined &&
          ts.isTypeReferenceNode(type) &&
          ts.isIdentifier(type.typeName) &&
          type.typeName.text === owner.name.text
        ) {
          return `${name.text}.`;
        }
      }
    }
  }
  return undefined;
};

/**
 * The polyfill's static functions and instance members, but not the `length`
 * and `name` every class has, which would send most accesses to the type
 * checker.
 */
const temporalMemberNames = new Set(
  Object.values(PolyfillTemporal).flatMap((namespace) => [
    ...Object.getOwnPropertyNames(namespace).filter(
      (name) => typeof Object(namespace)[name] === "function"
    ),
    ...Object.getOwnPropertyNames(Object(namespace).prototype ?? {}).filter(
      (name) => name !== "constructor"
    ),
  ])
);

/**
 * The Temporal APIs Workspace code uses, named as `listTemporalApis` names
 * them. The type checker resolves each member access, so instance members
 * count wherever their values come from, as do destructured members. Only
 * accesses by a member name Temporal has reach the type checker. Computed
 * keys and the `toString` that string conversion calls go unseen: resolving
 * them would send most of the app's expressions to the type checker.
 */
const usedTemporalApis = () => {
  const config = ts.getParsedCommandLineOfConfigFile(
    resolve(appRoot, "tsconfig.json"),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(
          ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
        );
      },
    }
  );
  if (config === undefined) throw new Error("tsconfig.json didn't parse.");
  const isAppTooling = (fileName: string) =>
    /^(?:e2e|scripts)\//.test(relative(appRoot, fileName));
  const program = ts.createProgram({
    rootNames: config.fileNames.filter((fileName) => !isAppTooling(fileName)),
    options: { ...config.options, incremental: false },
  });
  const checker = program.getTypeChecker();

  const used = new Set<string>();
  const recordAccess = (receiver: ts.Node, member: string) => {
    if (!temporalMemberNames.has(member)) return;
    const type = checker.getApparentType(
      checker.getNonNullableType(checker.getTypeAtLocation(receiver))
    );
    for (const part of type.isUnion() ? type.types : [type]) {
      const property = checker.getPropertyOfType(part, member);
      for (const declaration of property?.declarations ?? []) {
        const prefix = temporalApiPrefix(declaration);
        if (prefix !== undefined) used.add(`${prefix}${member}`);
      }
    }
  };
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node)) {
      recordAccess(node.expression, node.name.text);
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression)
    ) {
      recordAccess(node.expression, node.argumentExpression.text);
    } else if (
      ts.isBindingElement(node) &&
      ts.isObjectBindingPattern(node.parent) &&
      node.dotDotDotToken === undefined
    ) {
      const key = node.propertyName ?? node.name;
      if (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) {
        recordAccess(node.parent, key.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  for (const source of program.getSourceFiles()) {
    if (
      !source.isDeclarationFile &&
      !source.fileName.includes("/node_modules/") &&
      !isAppTooling(source.fileName)
    ) {
      visit(source);
    }
  }
  return [...used];
};

describe("isTemporalComplete", () => {
  test("accepts a complete Temporal", () => {
    expect(isComplete(PolyfillTemporal)).toBe(true);
  });

  test.each([
    ["no Temporal", undefined],
    ["an empty Temporal", {}],
    ["a Temporal without one entry point", withNamespace("PlainYearMonth", {})],
    ["a Temporal without one instance method", withoutInstanceMethod],
  ])("rejects %s", (_case, temporal) => {
    expect(isComplete(temporal)).toBe(false);
  });

  test("rejects a Temporal without the site's time zone data", () => {
    expect(
      isTemporalComplete(PolyfillTemporal, requiredTemporalApis, "Mars/Base")
    ).toBe(false);
  });

  test("checks exactly the Temporal APIs Workspace code uses", () => {
    expect(listTemporalApis(requiredTemporalApis).sort()).toEqual(
      usedTemporalApis().sort()
    );
  }, 180_000);
});

const { polyfill, loader } = await buildTemporalPolyfill();

/** A browser-like global with the given Temporal, or none. */
const browserContext = (temporal?: TemporalCandidate) => {
  const write = mock((_html: string) => {});
  const context = createContext({ document: { write } });
  runInContext("delete globalThis.Temporal", context);
  if (temporal !== undefined) context.Temporal = temporal;
  return { context, write };
};

describe("temporal-polyfill:build", () => {
  test("the loader can't end its inline script element early", () => {
    expect(loader).not.toMatch(/<\/script/i);
  });

  test("the loader requests nothing where Temporal is complete", () => {
    const { context, write } = browserContext(PolyfillTemporal);

    runInContext(loader, context);

    expect(write).not.toHaveBeenCalled();
  });

  test.each([
    ["missing", undefined],
    ["missing an entry point", withNamespace("PlainYearMonth", {})],
    ["missing an instance method", withoutInstanceMethod],
  ])(
    "the loader inserts the polyfill where Temporal is %s",
    (_case, temporal) => {
      const { context, write } = browserContext(temporal);

      runInContext(loader, context);

      expect(write).toHaveBeenCalledTimes(1);
      expect(write.mock.calls[0]?.[0]).toMatch(
        /^<script src="\/polyfills\/temporal\.js\?v=\w+"><\/script>$/
      );
    }
  );

  test.each([
    ["missing", undefined],
    ["missing an entry point", withNamespace("PlainYearMonth", {})],
    ["missing an instance method", withoutInstanceMethod],
  ])(
    "the polyfill installs a complete Temporal where it is %s",
    (_case, temporal) => {
      const { context } = browserContext(temporal);

      runInContext(polyfill, context);

      expect(isComplete(context.Temporal)).toBe(true);
    }
  );
});
