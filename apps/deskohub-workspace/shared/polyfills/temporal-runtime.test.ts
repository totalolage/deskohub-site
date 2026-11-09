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

/**
 * The polyfill with one class rebuilt on `standIn`, with the class's static
 * members and a prototype with `prototypeMembers`.
 */
const withRebuiltClass = (
  namespace: Exclude<TemporalNamespace, "Now">,
  standIn: () => void,
  prototypeMembers: PropertyDescriptorMap
): TemporalCandidate => {
  const temporalClass = PolyfillTemporal[namespace];
  const prototype = Object.create(
    Object.getPrototypeOf(temporalClass.prototype),
    prototypeMembers
  );
  return withNamespace(
    namespace,
    Object.defineProperties(standIn, {
      ...Object.getOwnPropertyDescriptors(temporalClass),
      prototype: { value: prototype },
    })
  );
};

/**
 * The polyfill with one instance member of a class replaced by `descriptor`,
 * or missing without one.
 */
const withInstanceMember = (
  namespace: Exclude<TemporalNamespace, "Now">,
  member: string,
  descriptor?: PropertyDescriptor
) => {
  const { [member]: _replaced, ...members } = Object.getOwnPropertyDescriptors(
    PolyfillTemporal[namespace].prototype
  );
  // biome-ignore lint/complexity/useArrowFunction: a constructible stand-in for the class.
  return withRebuiltClass(namespace, function () {}, {
    ...members,
    ...(descriptor && { [member]: descriptor }),
  });
};

/**
 * Temporal globals that lack, or can't use, an API Workspace code uses. The
 * members they break aren't ones the time zone probes reach.
 */
const incompleteTemporals: readonly (readonly [string, TemporalCandidate])[] = [
  ["is missing", undefined],
  ["is empty", {}],
  ["lacks an entry point", withNamespace("PlainYearMonth", {})],
  [
    "has a class that isn't a constructor",
    withRebuiltClass(
      "Duration",
      () => {},
      Object.getOwnPropertyDescriptors(PolyfillTemporal.Duration.prototype)
    ),
  ],
  [
    "lacks an instance method",
    withInstanceMember("ZonedDateTime", "toPlainDateTime"),
  ],
  [
    "has an undefined instance method",
    withInstanceMember("ZonedDateTime", "toPlainDateTime", {
      value: undefined,
    }),
  ],
  [
    "has an instance method that isn't a function",
    withInstanceMember("ZonedDateTime", "toPlainDateTime", { value: {} }),
  ],
  [
    "has a getter without a function",
    withInstanceMember("ZonedDateTime", "offset", { get: undefined }),
  ],
  [
    "has a method in place of a getter",
    withInstanceMember("ZonedDateTime", "offset", { value: () => "+01:00" }),
  ],
];

/**
 * Every API in `apis`: `PlainDate` for a class, `PlainDate.from` for a static
 * function, `PlainDate.prototype.add` for a method, and
 * `get PlainDate.prototype.day` for a getter.
 */
const listTemporalApis = (apis: TemporalApis) =>
  Object.entries(apis).flatMap(([namespace, members]) => [
    ...(members.methods !== undefined || members.getters !== undefined
      ? [namespace]
      : []),
    ...(members.static ?? []).map((member) => `${namespace}.${member}`),
    ...(members.methods ?? []).map(
      (member) => `${namespace}.prototype.${member}`
    ),
    ...(members.getters ?? []).map(
      (member) => `get ${namespace}.prototype.${member}`
    ),
  ]);

/** Whether `node` is the body of the `Temporal` namespace a declaration file declares. */
const isTemporalNamespace = (node: ts.Node): node is ts.ModuleBlock =>
  ts.isModuleBlock(node) &&
  node.parent.name.text === "Temporal" &&
  ts.isSourceFile(node.parent.parent);

/** Whether `node` is declared inside the `Temporal` namespace. */
const isDeclaredInTemporal = (node: ts.Declaration) =>
  ts.findAncestor(node, isTemporalNamespace) !== undefined;

/**
 * `PlainDate.` for a static member of a Temporal declaration,
 * `PlainDate.prototype.` for an instance method, and
 * `get PlainDate.prototype.` for an instance getter, in both the TypeScript
 * lib's declaration style and the polyfill's.
 */
const temporalApiPrefix = (member: ts.Declaration) => {
  const owner = member.parent;
  const scope = owner.parent;
  const instancePrefix = (className: string) =>
    ts.isMethodDeclaration(member) || ts.isMethodSignature(member)
      ? `${className}.prototype.`
      : `get ${className}.prototype.`;
  // `class PlainDate { static from(); add(); readonly day }`
  if (
    ts.isClassDeclaration(owner) &&
    owner.name &&
    isTemporalNamespace(scope)
  ) {
    return ts.canHaveModifiers(member) && ts.hasStaticModifier(member)
      ? `${owner.name.text}.`
      : instancePrefix(owner.name.text);
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
        if (name.text === owner.name.text) return instancePrefix(name.text);
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

/** The polyfill's classes, as opposed to the `Now` namespace. */
const temporalClassNames = Object.entries(PolyfillTemporal)
  .filter(([, namespace]) => namespace instanceof Function)
  .map(([name]) => name);

/**
 * The polyfill's static functions and instance members, but not the `length`
 * and `name` every class has, which would send most accesses to the type
 * checker.
 */
const temporalMemberNames = new Set(
  Object.values(PolyfillTemporal).flatMap((namespace) => [
    ...Object.getOwnPropertyNames(namespace).filter(
      (name) => Object(namespace)[name] instanceof Function
    ),
    ...Object.getOwnPropertyNames(Object(namespace).prototype ?? {}).filter(
      (name) => name !== "constructor"
    ),
  ])
);

/**
 * The instance methods JavaScript calls without code naming them: string
 * conversion calls `toString`, `JSON.stringify` calls `toJSON`, and
 * `Array.prototype.toLocaleString` calls `toLocaleString`. A Temporal value
 * can reach them inside any object or array, which the scan can't follow, so
 * every class counts as using them. `valueOf` is left out: Temporal's throws,
 * so no working code converts a Temporal value to a number or compares two
 * with `<`.
 */
const implicitlyCalledMethods = ["toJSON", "toLocaleString", "toString"];

/**
 * The Temporal APIs Workspace code uses, named as `listTemporalApis` names
 * them, and the places it reads members of a Temporal value in a way the scan
 * can't name: by a key whose type isn't a union of string literals, or by
 * calling a `Reflect` method on it directly. The `Reflect` check errs toward
 * failing, even on calls that read no member, and an aliased `Reflect`
 * escapes it.
 *
 * The type checker resolves each member access, so instance members count
 * wherever their values come from, as do destructured members and computed
 * keys whose type is a union of string literals. Only accesses by a member
 * name Temporal has reach the type checker, and a value typed `any` hides its
 * accesses from both. Every class counts as used along with
 * `implicitlyCalledMethods`: `new`, `instanceof` and `extends` need the class
 * itself, and any API can hand code an instance of a class it never names.
 */
const scanTemporalUses = () => {
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

  /** The types a value at `node` can have, apart from `null` and `undefined`. */
  const valueTypes = (node: ts.Node) => {
    const type = checker.getApparentType(
      checker.getNonNullableType(checker.getTypeAtLocation(node))
    );
    return type.isUnion() ? type.types : [type];
  };
  /** Whether a value at `node` can be a Temporal value, or extend one. */
  const isTemporalValue = (node: ts.Node) =>
    valueTypes(node).some((type) =>
      checker
        .getPropertiesOfType(type)
        .some((property) =>
          (property.declarations ?? []).some(isDeclaredInTemporal)
        )
    );
  /** The member names `key` can be, unless it can be any other string or a symbol. */
  const keyNames = (key: ts.Expression) => {
    const type = checker.getTypeAtLocation(key);
    const types = type.isUnion() ? type.types : [type];
    return types.every((type) => type.isStringLiteral())
      ? types.map((type) => type.value)
      : undefined;
  };

  const used = new Set<string>(
    temporalClassNames.flatMap((name) => [
      name,
      ...implicitlyCalledMethods.map((member) => `${name}.prototype.${member}`),
    ])
  );
  const unresolvedAccesses: string[] = [];
  const reportUnresolvedAccess = (node: ts.Node) => {
    const source = node.getSourceFile();
    const { line } = source.getLineAndCharacterOfPosition(node.getStart());
    unresolvedAccesses.push(
      `${relative(appRoot, source.fileName)}:${line + 1}`
    );
  };
  const recordAccess = (receiver: ts.Node, member: string) => {
    if (!temporalMemberNames.has(member)) return;
    for (const type of valueTypes(receiver)) {
      const property = checker.getPropertyOfType(type, member);
      for (const declaration of property?.declarations ?? []) {
        const prefix = temporalApiPrefix(declaration);
        if (prefix !== undefined) used.add(`${prefix}${member}`);
      }
    }
  };
  /** Records an access by a computed key, or reports one it can't resolve. */
  const recordKeyedAccess = (
    receiver: ts.Node,
    key: ts.Expression,
    at: ts.Node
  ) => {
    const names = keyNames(key);
    if (names !== undefined) {
      for (const name of names) recordAccess(receiver, name);
    } else if (isTemporalValue(receiver)) {
      reportUnresolvedAccess(at);
    }
  };
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node)) {
      recordAccess(node.expression, node.name.text);
    } else if (ts.isElementAccessExpression(node)) {
      recordKeyedAccess(node.expression, node.argumentExpression, node);
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "Reflect" &&
      node.arguments[0] !== undefined &&
      isTemporalValue(node.arguments[0])
    ) {
      reportUnresolvedAccess(node);
    } else if (
      ts.isBindingElement(node) &&
      ts.isObjectBindingPattern(node.parent) &&
      node.dotDotDotToken === undefined
    ) {
      const key = node.propertyName ?? node.name;
      if (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) {
        recordAccess(node.parent, key.text);
      } else if (ts.isComputedPropertyName(key)) {
        recordKeyedAccess(node.parent, key.expression, node);
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
  return { used: [...used], unresolvedAccesses };
};

describe("isTemporalComplete", () => {
  test("accepts a complete Temporal", () => {
    expect(isComplete(PolyfillTemporal)).toBe(true);
  });

  test("accepts a Temporal whose class is rebuilt with the same members", () => {
    const offset = Object.getOwnPropertyDescriptor(
      PolyfillTemporal.ZonedDateTime.prototype,
      "offset"
    );

    expect(
      isComplete(withInstanceMember("ZonedDateTime", "offset", offset))
    ).toBe(true);
  });

  test.each(incompleteTemporals)(
    "rejects a Temporal that %s",
    (_case, temporal) => {
      expect(isComplete(temporal)).toBe(false);
    }
  );

  test("rejects a Temporal without the site's time zone data", () => {
    expect(
      isTemporalComplete(PolyfillTemporal, requiredTemporalApis, "Mars/Base")
    ).toBe(false);
  });

  test("checks every class, its implicitly called methods, and each other Temporal API Workspace code uses", () => {
    const { used, unresolvedAccesses } = scanTemporalUses();

    expect(unresolvedAccesses).toEqual([]);
    expect(listTemporalApis(requiredTemporalApis).sort()).toEqual(used.sort());
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

  test.each(incompleteTemporals)(
    "the loader inserts the polyfill where Temporal %s",
    (_case, temporal) => {
      const { context, write } = browserContext(temporal);

      runInContext(loader, context);

      expect(write).toHaveBeenCalledTimes(1);
      expect(write.mock.calls[0]?.[0]).toMatch(
        /^<script src="\/polyfills\/temporal\.js\?v=\w+"><\/script>$/
      );
    }
  );

  test.each(incompleteTemporals)(
    "the polyfill installs a complete Temporal where the native one %s",
    (_case, temporal) => {
      const { context } = browserContext(temporal);

      runInContext(polyfill, context);

      expect(isComplete(context.Temporal)).toBe(true);
    }
  );
});
