import type { CnfExpression } from "@/shared/utils/normalize-tag-expression";
import type { CloudinaryTag } from "../types/cloudinary-tag";

/**
 * Converts a normalized CNF expression to a Cloudinary search string
 *
 * Examples:
 * - [["tag1"]] -> "tags=tag1"
 * - [["tag1"], ["tag2"]] -> "(tags=tag1 OR tags=tag2)"
 * - [["tag1", "tag2"]] -> "(tags=tag1 AND tags=tag2)"
 * - [["tag1"], ["tag2", "tag3"]] -> "(tags=tag1 OR (tags=tag2 AND tags=tag3))"
 * - [["!tag1"]] -> "NOT tags=tag1"
 * - [["tag1", "!tag2"]] -> "(tags=tag1 AND NOT tags=tag2)"
 */
export function cnfToCloudinaryExpression(
  cnf: CnfExpression<CloudinaryTag>
): string {
  if (cnf.length === 0) {
    return "resource_type:image";
  }

  const expressions = cnf
    .map((andGroup) => {
      if (andGroup.length === 0) return null;

      // For multiple tags in AND group
      if (andGroup.length > 1) {
        // Separate positive and negative tags
        const positiveTags: string[] = [];
        const negativeTags: string[] = [];

        andGroup.forEach((tag) => {
          if (tag.startsWith("!")) {
            negativeTags.push(tag.slice(1));
          } else {
            positiveTags.push(tag);
          }
        });

        const parts: string[] = [];

        // Add positive tags - use parentheses with AND for exact matching
        if (positiveTags.length > 0) {
          // Build separate tags= expressions and join with AND
          const tagExpressions = positiveTags.map((tag) => {
            // Quote tags with spaces
            if (tag.includes(" ")) {
              return `tags="${tag}"`;
            }
            return `tags=${tag}`;
          });

          // Join all tag expressions with AND
          parts.push(`(${tagExpressions.join(" AND ")})`);
        }

        // Add negative tags - these can use comma syntax
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

      // Single tag - need to handle spaces and negation properly
      const tag = andGroup[0];
      if (!tag) return null;

      // Check if this is a negative tag
      const isNegative = tag.startsWith("!");
      const actualTag = isNegative ? tag.slice(1) : tag;

      // Build the tag expression with proper quoting for spaces
      let tagValue: string;
      if (actualTag.includes(" ")) {
        tagValue = `"${actualTag}"`;
      } else {
        tagValue = actualTag;
      }

      // Use -tags: for negation, tags= for positive (Cloudinary uses = for exact match)
      return isNegative ? `-tags:${tagValue}` : `tags=${tagValue}`;
    })
    .filter(Boolean);

  if (expressions.length === 0) {
    return "resource_type:image";
  }

  if (expressions.length === 1) {
    // Single expression - don't add resource_type:image when we have negative tags
    const expr = expressions[0];
    // Check if expression contains negative tags
    if (expr?.includes("-tags:")) {
      // Don't add resource_type:image as it causes issues with negative tags
      return expr;
    }
    return `${expr} AND resource_type:image`;
  }

  // Multiple expressions = OR them together
  // Each AND expression needs parentheses when ORed with others
  const wrappedExpressions = expressions.map((expr) => {
    // Only wrap if it contains AND (multiple conditions)
    if (expr.includes(" AND ")) {
      return `(${expr})`;
    }
    return expr;
  });

  // Check if any expression has negative tags
  const hasNegativeTags = expressions.some((expr) => expr.includes("-tags:"));
  if (hasNegativeTags) {
    // Don't add resource_type:image when we have negative tags
    return `(${wrappedExpressions.join(" OR ")})`;
  }

  return `(${wrappedExpressions.join(" OR ")}) AND resource_type:image`;
}
