import { DotyposService } from "@deskohub/dotypos";
import { Effect } from "effect";

/**
 * Every Dotypos discount group that exists: not deleted and with an ID. A
 * blank name is null, so each caller names it in its own language.
 */
export const listDiscountGroups = DotyposService.pipe(
  Effect.flatMap((dotypos) => dotypos.getDiscountGroups()),
  Effect.map((groups) =>
    groups.flatMap(({ id, name, deleted }) =>
      id && !deleted ? [{ id, name: name?.trim() || null }] : []
    )
  )
);

export type DiscountGroupListing = Effect.Success<
  typeof listDiscountGroups
>[number];
