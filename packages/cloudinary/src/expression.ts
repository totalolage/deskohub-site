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

function quoteTagIfNeeded(tag: string): string {
  if (tag.includes(" ")) {
    return `"${tag}"`;
  }

  return tag;
}

function toPositiveTagExpression(tag: string): string {
  const tagValue = quoteTagIfNeeded(tag);

  return `tags=${tagValue}`;
}

function toNegativeTagValue(tag: string): string {
  return quoteTagIfNeeded(tag.startsWith("!") ? tag.slice(1) : tag);
}

function toGroupExpression<T extends string>(andGroup: readonly T[]) {
  if (andGroup.length === 0) {
    return null;
  }

  if (andGroup.length === 1) {
    const tag = andGroup[0];
    if (!tag) {
      return null;
    }

    return tag.startsWith("!")
      ? `-tags:${toNegativeTagValue(tag)}`
      : toPositiveTagExpression(tag);
  }

  const positiveTags = andGroup.filter((tag) => !tag.startsWith("!"));
  const negativeTags = andGroup.filter((tag) => tag.startsWith("!"));
  const parts: string[] = [];

  if (positiveTags.length > 0) {
    parts.push(
      `(${positiveTags.map((tag) => toPositiveTagExpression(tag)).join(" AND ")})`
    );
  }

  if (negativeTags.length > 0) {
    parts.push(`-tags:${negativeTags.map(toNegativeTagValue).join(",")}`);
  }

  return parts.join(" AND ");
}

export function cnfToCloudinaryExpression<T extends string>(
  cnf: CnfExpression<T>
): string {
  if (cnf.length === 0) {
    return "resource_type:image";
  }

  const expressions = cnf
    .map(toGroupExpression)
    .filter((expression): expression is string => Boolean(expression));

  if (expressions.length === 0) {
    return "resource_type:image";
  }

  if (expressions.length === 1) {
    const expression = expressions[0]!;
    if (expression.includes("-tags:")) {
      return expression;
    }

    return `${expression} AND resource_type:image`;
  }

  const wrappedExpressions = expressions.map((expression) => {
    if (expression.includes(" AND ")) {
      return `(${expression})`;
    }

    return expression;
  });

  const hasNegativeTags = expressions.some((expression) =>
    expression.includes("-tags:")
  );

  if (hasNegativeTags) {
    return `(${wrappedExpressions.join(" OR ")})`;
  }

  return `(${wrappedExpressions.join(" OR ")}) AND resource_type:image`;
}
