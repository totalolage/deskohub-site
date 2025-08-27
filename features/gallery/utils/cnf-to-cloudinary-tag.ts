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

      // For multiple tags in AND group, use proper AND syntax
      if (andGroup.length > 1) {
        // Use AND syntax: (tags=tag1 AND tags=tag2)
        const andExpression = andGroup
          .map((tag) => {
            // If tag contains spaces, wrap in quotes
            if (tag.includes(" ")) {
              return `tags="${tag}"`;
            }
            return `tags=${tag}`;
          })
          .join(" AND ");
        return `(${andExpression})`;
      }

      // Single tag - need to handle spaces properly
      const tag = andGroup[0];
      if (!tag) return null;
      // If tag contains spaces, wrap in quotes
      if (tag.includes(" ")) {
        return `tags="${tag}"`;
      }
      return `tags=${tag}`;
    })
    .filter(Boolean);

  if (expressions.length === 0) {
    return "resource_type:image";
  }

  if (expressions.length === 1) {
    return `${expressions[0]} AND resource_type:image`;
  }

  // Multiple expressions = OR them together
  return `(${expressions.join(" OR ")}) AND resource_type:image`;
}
