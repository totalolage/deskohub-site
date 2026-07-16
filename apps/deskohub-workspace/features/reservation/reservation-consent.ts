import { Schema } from "effect";
import { m } from "@/features/i18n";

export const reservationLegalConsentSchema = Schema.Boolean.check(
  Schema.makeFilter(Boolean, {
    message: m.reservationValidationLegalConsentRequired(),
  })
);

export type ReservationLegalConsent = typeof reservationLegalConsentSchema.Type;
