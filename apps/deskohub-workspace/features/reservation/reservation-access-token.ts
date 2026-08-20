import { Schema } from "effect";

export const reservationAccessTokenQueryParam = "accessToken" as const;

export const reservationAccessTokenSchema = Schema.NonEmptyString.check(
  Schema.isMaxLength(4096)
)
  .pipe(Schema.brand("ReservationAccessToken"))
  .annotate({
    identifier: "ReservationAccessToken",
    description: "Signed capability for a protected reservation page.",
  });
export type ReservationAccessToken = typeof reservationAccessTokenSchema.Type;
