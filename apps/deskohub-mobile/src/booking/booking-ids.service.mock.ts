import { Effect, Layer } from "effect";
import { BookingIds } from "./booking-ids.service";

/**
 * Numbered ids (`session-1`, `attempt-1`, `attempt-2`, …), so tests can name
 * the ids a checkout sends. Each Layer counts on its own.
 */
export const sequentialBookingIds = (): Layer.Layer<BookingIds> => {
  let sessions = 0;
  let attempts = 0;
  return Layer.succeed(BookingIds, {
    checkoutSessionId: Effect.sync(() => {
      sessions += 1;
      return `session-${sessions}`;
    }),
    checkoutAttemptId: Effect.sync(() => {
      attempts += 1;
      return `attempt-${attempts}`;
    }),
  });
};
