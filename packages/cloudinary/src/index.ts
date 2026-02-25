export type CnfExpression<T extends string> = readonly (readonly T[])[];

export function cnfToCloudinaryExpression<T extends string>(
  cnf: CnfExpression<T>
): string {
  if (cnf.length === 0) {
    return "resource_type:image";
  }

  const expressions = cnf
    .map((andGroup) => {
      if (andGroup.length === 0) return null;

      if (andGroup.length > 1) {
        const positiveTags: string[] = [];
        const negativeTags: string[] = [];

        andGroup.forEach((tag) => {
          if (tag.startsWith("!")) {
            negativeTags.push(tag.slice(1));
            return;
          }

          positiveTags.push(tag);
        });

        const parts: string[] = [];

        if (positiveTags.length > 0) {
          const tagExpressions = positiveTags.map((tag) => {
            if (tag.includes(" ")) {
              return `tags="${tag}"`;
            }
            return `tags=${tag}`;
          });

          parts.push(`(${tagExpressions.join(" AND ")})`);
        }

        if (negativeTags.length > 0) {
          const negativeExpr = negativeTags
            .map((tag) => {
              if (tag.includes(" ")) {
                return `"${tag}"`;
              }
              return tag;
            })
            .join(",");

          parts.push(`-tags:${negativeExpr}`);
        }

        return parts.join(" AND ");
      }

      const tag = andGroup[0];
      if (!tag) return null;

      const isNegative = tag.startsWith("!");
      const actualTag = isNegative ? tag.slice(1) : tag;
      const tagValue = actualTag.includes(" ") ? `"${actualTag}"` : actualTag;

      return isNegative ? `-tags:${tagValue}` : `tags=${tagValue}`;
    })
    .filter((expr): expr is string => Boolean(expr));

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
