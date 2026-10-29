import "server-only";

import type {
  ReservationProductFilterType,
  ReservationProductPropertyCondition,
} from "@deskohub/workspace-admin-api";
import {
  and,
  eq,
  gt,
  gte,
  inArray,
  lt,
  lte,
  ne,
  notInArray,
  type SQL,
  sql,
} from "drizzle-orm";
import { Match } from "effect";
import { StoredReservationDetails } from "@/features/reservation/backend/stored-reservation-details.server";
import { isReservationProductPropertyId } from "@/features/reservation/reservation-product-descriptor";

const propertyCondition = (
  value: SQL,
  condition: ReservationProductPropertyCondition
): SQL =>
  Match.value(condition).pipe(
    Match.when({ operator: "anyOf" }, (choice) =>
      inArray(value, [...choice.value])
    ),
    Match.when(
      { operator: "noneOf" },
      (choice) => sql`coalesce(${notInArray(value, [...choice.value])}, false)`
    ),
    Match.when(
      { operator: "is" },
      (flag) => sql`coalesce(${eq(value, flag.value)}, false)`
    ),
    Match.when({ operator: "eq" }, (count) => eq(value, count.value)),
    Match.when({ operator: "ne" }, (count) => ne(value, count.value)),
    Match.when({ operator: "lt" }, (count) => lt(value, count.value)),
    Match.when({ operator: "lte" }, (count) => lte(value, count.value)),
    Match.when({ operator: "gt" }, (count) => gt(value, count.value)),
    Match.when({ operator: "gte" }, (count) => gte(value, count.value)),
    Match.exhaustive
  );

/**
 * Selects reservations of the product family whose snapshot meets every
 * property condition. A snapshot without a readable value matches no property
 * condition, and an unknown property matches nothing; audience filters are
 * validated against the catalog before they're stored.
 */
export const reservationProductCondition = ({
  family,
  properties,
}: ReservationProductFilterType): SQL =>
  and(
    sql`${StoredReservationDetails.kind} = ${family}`,
    ...properties.map((condition) =>
      isReservationProductPropertyId(family, condition.property)
        ? propertyCondition(
            StoredReservationDetails.property(family, condition.property),
            condition
          )
        : sql`false`
    )
  )!;
