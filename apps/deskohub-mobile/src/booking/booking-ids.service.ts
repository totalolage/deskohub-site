import { Context, Effect, Layer } from "effect";
import * as Crypto from "expo-crypto";

interface IBookingIds {
  /** Names one checkout while the customer stays on it. */
  readonly checkoutSessionId: Effect.Effect<string>;
  /**
   * Names one submission of the details form. Resending the same create
   * with it gets the order that attempt already made.
   */
  readonly checkoutAttemptId: Effect.Effect<string>;
}

/** The ids a checkout sends so the server can recognise a resent create. */
export class BookingIds extends Context.Service<BookingIds, IBookingIds>()(
  "deskohub-mobile/BookingIds"
) {
  static Default = Layer.succeed(this, {
    checkoutSessionId: Effect.sync(() => Crypto.randomUUID()),
    checkoutAttemptId: Effect.sync(() => Crypto.randomUUID()),
  });
}
