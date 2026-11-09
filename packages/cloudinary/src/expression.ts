export type UnnormalizedLogicalExpression<T> =
  | T
  | readonly UnnormalizedLogicalExpression<T>[];

export type CnfExpression<T extends string> = readonly (readonly T[])[];

function flattenExpression<T extends string>(
  expression: UnnormalizedLogicalExpression<T>
): T[] {
  if (typeof expression === "string") {
    return [expression];
  }

  return expression.flatMap((item) => flattenExpression(item));
}

export function normalizeExpression<T extends string>(
  expression: UnnormalizedLogicalExpression<T>
): CnfExpression<T> {
  if (typeof expression === "string") {
    return [[expression]];
  }

  return expression
    .map(flattenExpressionToSortedGroup)
    .filter((group) => group.length > 0)
    .sort((left, right) => left.join(",").localeCompare(right.join(",")));
}

function flattenExpressionToSortedGroup<T extends string>(
  expression: UnnormalizedLogicalExpression<T>
): T[] {
  return flattenExpression(expression).sort();
}
