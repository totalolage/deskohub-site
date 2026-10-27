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

/**
 * Expires the cached calendar discount source and schedules priming today's
 * and tomorrow's after the response, for a mutation that changed the source.
 * It throws when Next.js refuses, so call it from the request's own async
 * context: under another request's work store, tag invalidation throws while
 * that request renders. An Admin UI action passes it to the action edge's
 * `refreshes`, which runs it after the action settles.
 */
export const startCalendarDiscountSourceRefresh = (
  input: DiscountAdminMutation
) => {
  if (!discountMutationChangesCalendarSource(input)) return;
  revalidateTag(calendarDiscountSourceTag, { expire: 0 });
  after(() =>
    primeCurrentCalendarDiscountSources().pipe(
      runWorkspaceEffect("discounts.calendar-source.prime")
    )
  );
};

/**
 * Starts the refresh from inside a fiber, for the administration API. Best
 * effort: a refresh that can't start is logged and skipped.
 */
export const refreshCalendarDiscountSourceAfterMutation = Effect.fn(
  "DiscountAdministration.refreshCalendarSource"
)((input: DiscountAdminMutation) =>
  Effect.try({
    try: () => startCalendarDiscountSourceRefresh(input),
    catch: (cause) => new CalendarDiscountSourceMaintenanceError({ cause }),
  }).pipe(
    Effect.tapError((cause) =>
      Effect.logWarning("Calendar discount cache refresh could not start", {
        cause,
      })
    ),
    Effect.ignore
  )
);

const primeCurrentCalendarDiscountSources = Effect.fn(
  "DiscountAdministration.primeCalendarSources"
)(() => {
  const today = getCurrentWorkspaceDate();
  const dates = [today, today.add({ days: 1 })].map((date) => date.toString());

  return Effect.forEach(
    dates,
    (bookingDate) =>
      Effect.tryPromise({
        try: () => loadCalendarDiscountSource(bookingDate),
        catch: (cause) => new CalendarDiscountSourceMaintenanceError({ cause }),
      }).pipe(
        Effect.tap((source) =>
          Effect.logWarning("Calendar discount cache prime was incomplete", {
            bookingDate,
          }).pipe(Effect.when(Effect.succeed(!source.complete)))
        ),
        Effect.catch((cause) =>
          Effect.logWarning("Calendar discount cache prime failed", {
            cause,
            bookingDate,
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
