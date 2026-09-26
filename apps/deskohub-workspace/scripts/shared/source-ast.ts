import { readFileSync } from "node:fs";
import { parse } from "@typescript-eslint/parser";
import type { TSESTree } from "@typescript-eslint/types";
import { isString } from "effect/Predicate";

/**
 * Parsed-TypeScript structured checks for source contracts.
 *
 * Verdicts are computed from the real syntax tree of a tracked module, so
 * they are immune to formatting, whitespace, and comments: a commented-out
 * call never satisfies a presence check, and a reformatted call never fails
 * one. This replaces the retired source-as-string (substring/token) pattern.
 */

type AnyNode = TSESTree.Node;

export type ParsedSource = {
  readonly ast: TSESTree.Program;
  readonly source: string;
};

export const parseSource = (
  code: string,
  options: { readonly jsx?: boolean } = {}
): TSESTree.Program =>
  parse(code, {
    comment: false,
    ecmaFeatures: { jsx: options.jsx ?? false },
    range: true,
    sourceType: "module",
  });

export const parseTrackedSource = (filePath: string): ParsedSource => {
  const source = readFileSync(filePath, "utf8");
  return {
    ast: parseSource(source, { jsx: filePath.endsWith(".tsx") }),
    source,
  };
};

type NodeCandidate = { readonly type?: unknown };

const isNode = (value: NodeCandidate): value is { readonly type: string } =>
  isString(value.type);

const asNode = (value: NodeCandidate): AnyNode => value as AnyNode;

/** Every syntax node in the tree, parents before children. */
export const nodesOf = (root: AnyNode): readonly AnyNode[] => {
  const collected: AnyNode[] = [];
  const visit = (node: AnyNode): void => {
    collected.push(node);
    for (const [key, value] of Object.entries(node)) {
      if (key === "parent" || key === "range" || key === "loc") continue;
      if (value === null || value === undefined) continue;
      if (Array.isArray(value)) {
        for (const entry of value) {
          if (entry !== null && entry !== undefined && isNode(entry)) {
            visit(asNode(entry));
          }
        }
      } else if (isNode(value)) {
        visit(asNode(value));
      }
    }
  };
  visit(root);
  return collected;
};

type RangedNode = AnyNode & { readonly range: [number, number] };

const hasRange = (node: AnyNode): node is RangedNode =>
  Array.isArray((node as RangedNode).range);

/** True when `inner` sits lexically inside `outer` (range containment). */
export const containsNode = (outer: AnyNode, inner: AnyNode): boolean =>
  hasRange(outer) &&
  hasRange(inner) &&
  outer.range[0] <= inner.range[0] &&
  inner.range[1] <= outer.range[1];

/** Negative when `left` starts before `right`. */
export const positionDelta = (left: AnyNode, right: AnyNode): number =>
  (hasRange(left) ? left.range[0] : 0) - (hasRange(right) ? right.range[0] : 0);

/** Call expressions whose callee resolves to the bare identifier `name`. */
export const callsNamed = (
  root: AnyNode,
  name: string
): readonly TSESTree.CallExpression[] =>
  nodesOf(root).flatMap((node) =>
    node.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === name
      ? [node]
      : []
  );

/** Call expressions invoked as `<anything>.<property>()` for `property`. */
export const methodCallsNamed = (
  root: AnyNode,
  property: string
): readonly TSESTree.CallExpression[] =>
  nodesOf(root).flatMap((node) =>
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    !node.callee.computed &&
    node.callee.property.type === "Identifier" &&
    node.callee.property.name === property
      ? [node]
      : []
  );

/**
 * Call expressions invoked as `<objectName>.<property>()`, matching the
 * `<owner>.<operation>` call shape without touching any source text.
 */
export const memberCallsNamed = (
  root: AnyNode,
  objectName: string,
  property: string
): readonly TSESTree.CallExpression[] =>
  methodCallsNamed(root, property).filter(
    (call) =>
      call.callee.type === "MemberExpression" &&
      call.callee.object.type === "Identifier" &&
      call.callee.object.name === objectName
  );

/** Every distinct identifier or member-property name referenced in the tree. */
export const identifierNames = (root: AnyNode): ReadonlySet<string> => {
  const names = new Set<string>();
  for (const node of nodesOf(root)) {
    if (node.type === "Identifier" && isString(node.name)) {
      names.add(node.name);
    }
    if (
      node.type === "MemberExpression" &&
      !node.computed &&
      node.property.type === "Identifier" &&
      isString(node.property.name)
    ) {
      names.add(node.property.name);
    }
  }
  return names;
};

/** Values of string literals in the tree, with their nodes. */
export const stringLiterals = (
  root: AnyNode
): readonly { readonly node: TSESTree.Literal; readonly value: string }[] =>
  nodesOf(root).flatMap((node) => {
    if (node.type !== "Literal") return [];
    return isString(node.value) ? [{ node, value: node.value }] : [];
  });

/** Module specifiers of every static import declaration. */
export const importSpecifiers = (root: AnyNode): readonly string[] =>
  nodesOf(root).flatMap((node) =>
    node.type === "ImportDeclaration" ? [node.source.value as string] : []
  );

/** Names exported by `export { ... }` / `export const ...` declarations. */
export const exportedNames = (root: TSESTree.Program): readonly string[] => {
  const names: string[] = [];
  for (const statement of root.body) {
    if (statement.type === "ExportAllDeclaration") names.push("*");
    if (statement.type !== "ExportNamedDeclaration") continue;
    const declaration = statement.declaration;
    if (declaration?.type === "VariableDeclaration") {
      for (const declarator of declaration.declarations) {
        if (declarator.id.type === "Identifier") names.push(declarator.id.name);
      }
    } else if (
      declaration?.type === "FunctionDeclaration" ||
      declaration?.type === "ClassDeclaration" ||
      declaration?.type === "TSEnumDeclaration" ||
      declaration?.type === "TSInterfaceDeclaration" ||
      declaration?.type === "TSTypeAliasDeclaration"
    ) {
      if (declaration.id) names.push(declaration.id.name);
    }
    for (const specifier of statement.specifiers) {
      if (specifier.local.type === "Identifier")
        names.push(specifier.local.name);
    }
  }
  return names;
};

/** Property assignments of an object literal, keyed by property name. */
export const propertyAssignments = (
  object: TSESTree.ObjectExpression
): ReadonlyMap<string, TSESTree.Property> => {
  const entries = new Map<string, TSESTree.Property>();
  for (const property of object.properties) {
    if (property.type !== "Property") continue;
    if (property.key.type === "Identifier") {
      entries.set(property.key.name, property);
    } else if (property.key.type === "Literal") {
      entries.set(String(property.key.value), property);
    }
  }
  return entries;
};

/**
 * The initializer node of a top-level (possibly exported) `const <name> =
 * <init>` declaration, or undefined when the module does not declare it.
 */
export const topLevelConstInitializer = (
  root: TSESTree.Program,
  name: string
): AnyNode | undefined => {
  for (const statement of root.body) {
    if (
      statement.type !== "ExportNamedDeclaration" &&
      statement.type !== "VariableDeclaration"
    ) {
      continue;
    }
    const declaration =
      statement.type === "ExportNamedDeclaration"
        ? statement.declaration
        : statement;
    if (declaration?.type !== "VariableDeclaration") continue;
    for (const declarator of declaration.declarations) {
      if (
        declarator.id.type === "Identifier" &&
        declarator.id.name === name &&
        declarator.init
      ) {
        return declarator.init;
      }
    }
  }
  return undefined;
};

/** The first call argument when it is a string literal. */
export const firstStringArgument = (
  call: TSESTree.CallExpression
): string | undefined => {
  const argument = call.arguments[0];
  return argument !== undefined &&
    argument.type === "Literal" &&
    isString(argument.value)
    ? argument.value
    : undefined;
};

/** Every string literal found among a call's direct arguments. */
export const stringArguments = (
  call: TSESTree.CallExpression
): readonly string[] =>
  call.arguments.flatMap((argument) => {
    if (argument.type !== "Literal") return [];
    return isString(argument.value) ? [argument.value] : [];
  });

/**
 * Awaited `await name(...)` calls inside `scope`, ordered by source position.
 */
export const awaitedCallsInOrder = (
  scope: AnyNode,
  name: string
): readonly TSESTree.CallExpression[] =>
  nodesOf(scope)
    .flatMap((node) =>
      node.type === "AwaitExpression" && node.argument.type === "CallExpression"
        ? [node.argument]
        : []
    )
    .filter(
      (call) => call.callee.type === "Identifier" && call.callee.name === name
    )
    .sort(positionDelta);
