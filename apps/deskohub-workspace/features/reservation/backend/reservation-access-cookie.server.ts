import "server-only";

import { Context, Effect, Layer } from "effect";
import { cookies } from "next/headers";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  type ReservationAccessCookieCapability,
  ReservationAccessCookieError,
  writeReservationAccessCookie,
} from "./reservation-access-cookie";

interface IReservationAccessCookieWriter {
  readonly write: (input: {
    readonly orderId: WorkspaceReservationId;
    readonly capability: ReservationAccessCookieCapability;
  }) => Effect.Effect<void, ReservationAccessCookieError>;
}

export class ReservationAccessCookieWriter extends Context.Service<
  ReservationAccessCookieWriter,
  IReservationAccessCookieWriter
>()("ReservationAccessCookieWriter") {
  static Default = Layer.effect(
    this,
    Effect.tryPromise({
      try: () => cookies(),
      catch: () =>
        new ReservationAccessCookieError({
          code: "store-unavailable",
          message: "Reservation access cookie storage is unavailable.",
        }),
    }).pipe(
      Effect.map((store) => ({
        write: Effect.fn("ReservationAccessCookieWriter.write")(
          function* (input) {
            yield* writeReservationAccessCookie(store, input);
          }
        ),
      }))
    )
  );

  static Live = this.Default;
}
