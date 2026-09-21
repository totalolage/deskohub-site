import { Data, Effect } from "effect";
import * as ts from "typescript";

const recursiveDeclarationsMarker = "// recursive declarations";
const nonRecursiveDefinitionsMarker = "// non-recursive definitions";
const recursiveDefinitionsMarker = "// recursive definitions";
const schemasMarker = "// schemas";

class GeneratedClientNormalizationError extends Data.TaggedError(
  "GeneratedClientNormalizationError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const normalizationError = (
  message: string,
  cause?: unknown
): GeneratedClientNormalizationError =>
  new GeneratedClientNormalizationError({
    message: `Could not normalize the generated PostHog client's recursive schemas: ${message}`,
    cause,
  });

interface RecursiveSections {
  readonly declarationsSpan: [number, number];
  readonly recursiveDefinitionsSpan: [number, number];
}

const uniqueMarkerPosition = (
  source: string,
  marker: string
): number | GeneratedClientNormalizationError => {
  const first = source.indexOf(marker);
  if (first < 0) return -1;
  if (source.indexOf(marker, first + 1) >= 0) {
    return normalizationError(
      `"${marker}" section marker appears more than once`
    );
  }
  return first;
};

/**
 * Maps the generated client's section layout. The generator only emits section
 * markers for nonempty sections, so the declarations and recursive-definitions
 * markers are optional; when the recursive-definitions section is absent the
 * client has no recursion and must pass through untouched. Any marker that is
 * present but out of order is rejected as an unsupported layout.
 */
const locateRecursiveSections = (
  source: string
): RecursiveSections | null | GeneratedClientNormalizationError => {
  const markers: [
    number | GeneratedClientNormalizationError,
    number | GeneratedClientNormalizationError,
    number | GeneratedClientNormalizationError,
    number | GeneratedClientNormalizationError,
  ] = [
    uniqueMarkerPosition(source, recursiveDeclarationsMarker),
    uniqueMarkerPosition(source, nonRecursiveDefinitionsMarker),
    uniqueMarkerPosition(source, recursiveDefinitionsMarker),
    uniqueMarkerPosition(source, schemasMarker),
  ];
  for (const marker of markers) {
    if (marker instanceof GeneratedClientNormalizationError) return marker;
  }
  const [declarations, nonRecursive, recursive, schemas] = markers;
  if (declarations instanceof GeneratedClientNormalizationError) {
    return declarations;
  }
  if (nonRecursive instanceof GeneratedClientNormalizationError) {
    return nonRecursive;
  }
  if (recursive instanceof GeneratedClientNormalizationError) {
    return recursive;
  }
  if (schemas instanceof GeneratedClientNormalizationError) {
    return schemas;
  }
  if (recursive < 0) {
    if (declarations >= 0) {
      return normalizationError(
        `"${recursiveDeclarationsMarker}" section without a "${recursiveDefinitionsMarker}" section`
      );
    }
    return null;
  }
  if (schemas < 0) {
    return normalizationError(
      `missing trailing "${schemasMarker}" section marker`
    );
  }
  const bounds = [declarations, nonRecursive, recursive, schemas].filter(
    (position) => position >= 0
  );
  const sorted = [...bounds].sort((first, second) => first - second);
  for (const [index, position] of bounds.entries()) {
    if (position !== sorted[index]) {
      return normalizationError(
        "section markers appear in an unexpected order"
      );
    }
  }
  const after = (position: number): number => {
    for (const candidate of [nonRecursive, recursive, schemas]) {
      if (candidate > position) return candidate;
    }
    return schemas;
  };
  return {
    declarationsSpan: [declarations, after(declarations)],
    recursiveDefinitionsSpan: [recursive, schemas],
  };
};

const isInsideRange = (position: number, range: [number, number]): boolean =>
  position >= range[0] && position < range[1];

/**
 * Public recursive schema names are the type alias names emitted alongside the
 * public schema consts in the recursive declarations and recursive definitions
 * sections. Internal `__recursive_` bindings have no type alias, so they are
 * excluded without relying on their naming prefix.
 */
const publicRecursiveNames = (
  sourceFile: ts.SourceFile,
  sections: RecursiveSections
): ReadonlySet<string> => {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isTypeAliasDeclaration(statement)) continue;
    if (
      isInsideRange(
        statement.getStart(sourceFile),
        sections.declarationsSpan
      ) ||
      isInsideRange(
        statement.getStart(sourceFile),
        sections.recursiveDefinitionsSpan
      )
    ) {
      names.add(statement.name.text);
    }
  }
  return names;
};

interface IdentifierReplacement {
  readonly start: number;
  readonly end: number;
  readonly name: string;
}

const isDeferredFunction = (node: ts.Node): boolean =>
  ts.isArrowFunction(node) || ts.isFunctionExpression(node);

/**
 * Collects eager runtime references to the public recursive schema names. Type
 * nodes, property names (shorthand or explicit), member names of property
 * accesses, declaration names, and references already inside deferred
 * functions are never rewritten; only value positions are.
 */
const collectEagerReferences = (
  initializer: ts.Expression,
  sourceFile: ts.SourceFile,
  names: ReadonlySet<string>
): IdentifierReplacement[] => {
  const replacements: IdentifierReplacement[] = [];
  const walk = (node: ts.Node): void => {
    if (isDeferredFunction(node)) return;
    if (ts.isTypeNode(node)) return;
    if (ts.isPropertyAssignment(node)) {
      walk(node.initializer);
      return;
    }
    if (ts.isShorthandPropertyAssignment(node)) return;
    if (ts.isPropertyAccessExpression(node)) {
      walk(node.expression);
      return;
    }
    if (ts.isIdentifier(node) && names.has(node.text)) {
      replacements.push({
        start: node.getStart(sourceFile),
        end: node.getEnd(),
        name: node.text,
      });
      return;
    }
    ts.forEachChild(node, walk);
  };
  walk(initializer);
  return replacements;
};

const suspendedReference = (name: string): string =>
  `Schema.suspend((): Schema.Codec<${name}> => ${name})`;

/**
 * Rewrites eager runtime references to public recursive schema names inside
 * the generated client's `// recursive definitions` initializers as deferred
 * `Schema.suspend` references. Works on the TypeScript AST so property keys,
 * string literals, type references, declaration names, and references that are
 * already inside deferred functions stay untouched, and the outer exported
 * constructors keep their Struct/Union shape. Clients without recursion are
 * returned unchanged. Idempotent.
 */
const normalizeRecursiveSchemasSync = (
  generatedClient: string
): string | GeneratedClientNormalizationError => {
  const sections = locateRecursiveSections(generatedClient);
  if (sections instanceof GeneratedClientNormalizationError) return sections;
  if (sections === null) return generatedClient;
  const sourceFile = ts.createSourceFile(
    "effect.gen.ts",
    generatedClient,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true
  );
  const names = publicRecursiveNames(sourceFile, sections);
  const replacements: IdentifierReplacement[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if (
      !isInsideRange(
        statement.getStart(sourceFile),
        sections.recursiveDefinitionsSpan
      )
    ) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.initializer === undefined) continue;
      replacements.push(
        ...collectEagerReferences(declaration.initializer, sourceFile, names)
      );
    }
  }
  let normalized = generatedClient;
  for (const { start, end, name } of [...replacements].sort(
    (first, second) => second.start - first.start
  )) {
    normalized =
      normalized.slice(0, start) +
      suspendedReference(name) +
      normalized.slice(end);
  }
  return normalized;
};

/**
 * Effect-returning wrapper around the pure normalizer. Section-layout and
 * parsing failures surface as a typed `GeneratedClientNormalizationError`
 * failure instead of a thrown exception inside an `Effect.gen` body; the pure
 * core returns classified failures as values, so no throw/catch round-trip is
 * needed.
 */
export const normalizeRecursiveSchemas = (
  generatedClient: string
): Effect.Effect<string, GeneratedClientNormalizationError> =>
  Effect.suspend(() => {
    const result = normalizeRecursiveSchemasSync(generatedClient);
    return typeof result === "string"
      ? Effect.succeed(result)
      : Effect.fail(result);
  });
