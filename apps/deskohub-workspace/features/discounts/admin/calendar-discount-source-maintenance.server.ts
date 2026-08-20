import "server-only";

import { Data, Effect } from "effect";
import { revalidateTag } from "next/cache";
import { after } from "next/server";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import {
  calendarDiscountSourceTag,
  loadCalendarDiscountSource,
} from "../calendar-discount-source.server";
import type { DiscountAdminMutation } from "./contracts";

class CalendarDiscountSourceMaintenanceError extends Data.TaggedError(
  "CalendarDiscountSourceMaintenanceError"
)<{
  readonly cause: unknown;
}> {}

export const refreshCalendarDiscountSourceAfterMutation = Effect.fn(
  "DiscountAdministration.refreshCalendarSource"
)((input: DiscountAdminMutation) =>
  Effect.try({
    try: () => {
      revalidateTag(calendarDiscountSourceTag, { expire: 0 });
      after(() =>
        primeCurrentCalendarDiscountSources().pipe(
          runWorkspaceEffect("discounts.calendar-source.prime")
        )
      );
    },
    catch: (cause) => new CalendarDiscountSourceMaintenanceError({ cause }),
  }).pipe(
    Effect.tapError((cause) =>
      Effect.logWarning("Calendar discount cache refresh could not start", {
        cause,
      })
    ),
    Effect.ignore,
    Effect.when(Effect.succeed(discountMutationChangesCalendarSource(input))),
    Effect.asVoid
  )
);

const primeCurrentCalendarDiscountSources = Effect.fn(
  "DiscountAdministration.primeCalendarSources"
)(() => {
  const today = getCurrentWorkspaceDate();
  const dates = [today, today.add({ days: 1 })].map((date) => date.toString());

  return Effect.forEach(
    dates,
    (reservationDate) =>
      Effect.tryPromise({
        try: () => loadCalendarDiscountSource(reservationDate),
        catch: (cause) => new CalendarDiscountSourceMaintenanceError({ cause }),
      }).pipe(
        Effect.tap((source) =>
          Effect.logWarning("Calendar discount cache prime was incomplete", {
            reservationDate,
          }).pipe(Effect.when(Effect.succeed(!source.complete)))
        ),
        Effect.catch((cause) =>
          Effect.logWarning("Calendar discount cache prime failed", {
            cause,
            reservationDate,
          })
        )
      ),
    { concurrency: "unbounded", discard: true }
  );
});

export const discountMutationChangesCalendarSource = (
  input: CalendarDiscountSourceMutation
): boolean => {
  switch (input.kind) {
    case "create-discount":
    case "update-discount":
    case "delete-discount":
      return true;
    case "create-code":
    case "create-customer-code":
      return input.discount.kind === "new";
    default:
      return false;
  }
};

type CalendarDiscountSourceMutation =
  | {
      readonly kind: "create-discount" | "delete-discount" | "update-discount";
    }
  | {
      readonly kind: "create-code" | "create-customer-code";
      readonly discount: { readonly kind: "existing" | "new" };
    }
  | {
      readonly kind: Exclude<
        DiscountAdminMutation["kind"],
        | "create-code"
        | "create-customer-code"
        | "create-discount"
        | "delete-discount"
        | "update-discount"
      >;
    };
