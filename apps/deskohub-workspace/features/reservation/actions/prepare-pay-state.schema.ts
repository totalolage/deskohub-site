import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Schema } from "effect";
import { locales } from "@/features/i18n";
import { normalizedCoworkReservationOrderSchema } from "@/features/reservation/cowork-reservation";
import { normalizedMeetingRoomReservationOrderSchema } from "@/features/reservation/meeting-room-reservation";

const preparePayStateBaseSchema = Schema.Struct({
  locale: Schema.Literals(locales),
  checkoutSessionId: Schema.NonEmptyString,
  checkoutAttemptId: Schema.NonEmptyString,
  legalConsent: Schema.optional(Schema.Boolean),
});

export const preparePayStateSchema = Schema.toStandardSchemaV1(
  Schema.Union([
    Schema.Struct({
      ...preparePayStateBaseSchema.fields,
      advertisedPriceToken: Schema.NonEmptyString,
      reservation: normalizedCoworkReservationOrderSchema,
    }),
    Schema.Struct({
      ...preparePayStateBaseSchema.fields,
      advertisedPriceToken: Schema.optionalKey(Schema.Never),
      reservation: normalizedMeetingRoomReservationOrderSchema,
    }),
  ]),
  { parseOptions: { onExcessProperty: "error" } }
);

export type PreparePayStateInput = StandardSchemaV1.InferOutput<
  typeof preparePayStateSchema
>;
