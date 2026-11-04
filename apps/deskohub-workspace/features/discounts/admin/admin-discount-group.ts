import type { DotyposDiscountGroup } from "@deskohub/dotypos";
import {
  type DotyposDiscountGroupId,
  DotyposDiscountGroupIdSchema,
} from "@deskohub/dotypos";
import { Option, Schema } from "effect";
import { toDotyposDiscountBasisPoints } from "../dotypos-discount-percentage";
import type { AdminDiscountGroup } from "./discount-administration.service";

/** A Dotypos discount group operators may assign: neither deleted nor hidden. */
export const isAssignableDotyposDiscountGroup = (
  group: Pick<DotyposDiscountGroup, "deleted" | "display">
) => !group.deleted && group.display !== false;

/**
 * An assignable Dotypos discount group with a valid ID and an exact
 * percentage, named by its ID when it has no name; none otherwise.
 */
export const toAdminDiscountGroup = (
  group: DotyposDiscountGroup
): readonly AdminDiscountGroup[] => {
  const id: DotyposDiscountGroupId | undefined = Option.getOrUndefined(
    Schema.decodeUnknownOption(DotyposDiscountGroupIdSchema)(group.id?.trim())
  );
  const basisPoints = toDotyposDiscountBasisPoints(group.discountPercent);
  if (
    !id ||
    !isAssignableDotyposDiscountGroup(group) ||
    basisPoints === undefined
  ) {
    return [];
  }

  return [{ id, name: group.name?.trim() || id, basisPoints }];
};
