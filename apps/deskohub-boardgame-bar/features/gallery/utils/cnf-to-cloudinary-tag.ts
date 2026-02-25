import {
  type CnfExpression,
  cnfToCloudinaryExpression as toCloudinaryExpression,
} from "@deskohub/cloudinary";
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
  return toCloudinaryExpression(cnf);
}
