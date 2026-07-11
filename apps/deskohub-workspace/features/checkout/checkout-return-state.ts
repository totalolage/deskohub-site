import {
  Effect,
  Schema as EffectSchema,
  Option,
  SchemaGetter,
  SchemaIssue,
} from "effect";
import {
  toWorkspaceCheckoutOrder,
  type WorkspaceCheckoutOrderInput,
} from "@/features/checkout/checkout-quote";
import {
  reservationCustomerEmailEffectSchema,
  reservationCustomerMessageEffectSchema,
  reservationCustomerNameEffectSchema,
  reservationCustomerPhoneEffectSchema,
} from "@/features/reservation/reservation-contact";
import {
  getReservationDurationMinutes,
  getReservationIntervalValidationIssue,
  isDefaultReservationInterval,
  meetingRoomReservationDurationMinutesEffectSchema,
  normalizeReservationInterval,
  unsafeNormalizeReservationInterval,
  wholeHourReservationInstantEffectSchema,
} from "@/features/reservation/reservation-interval";
import { makeWorkspaceReservationDetailsEffectSchema } from "@/features/reservation/stored-reservation-details";
import { isoDateTimeWithOffsetStringEffectSchema } from "@/shared/utils/effect-schema";
import { makeEffectSchemaParser } from "@/shared/utils/effect-schema-parser";

const CheckoutReturnStateReservationShapeSchema =
  makeWorkspaceReservationDetailsEffectSchema({
    startsAt: isoDateTimeWithOffsetStringEffectSchema,
    endsAt: isoDateTimeWithOffsetStringEffectSchema,
    name: reservationCustomerNameEffectSchema,
    email: reservationCustomerEmailEffectSchema,
    phone: reservationCustomerPhoneEffectSchema,
    message: EffectSchema.optional(reservationCustomerMessageEffectSchema),
  });

type CheckoutReturnStateReservationDraft =
  typeof CheckoutReturnStateReservationShapeSchema.Type;

const isMeetingRoomReservationDuration = EffectSchema.is(
  meetingRoomReservationDurationMinutesEffectSchema
);
const isWholeHourReservationInstant = EffectSchema.is(
  wholeHourReservationInstantEffectSchema
);

const checkoutReturnStateReservationDraftEffectSchema =
  CheckoutReturnStateReservationShapeSchema.check(
    EffectSchema.makeFilter<CheckoutReturnStateReservationDraft>(
      (reservation) => {
        const intervalIssue =
          getReservationIntervalValidationIssue(reservation);
        if (intervalIssue) {
          return [
            {
              path: [intervalIssue.path],
              issue: intervalIssue.message,
            },
          ];
        }

        const interval = unsafeNormalizeReservationInterval(reservation);
        const issues: Array<{
          readonly path: readonly PropertyKey[];
          readonly issue: string;
        }> = [];

        if (
          reservation._tag === "cowork" &&
          !isDefaultReservationInterval(interval)
        ) {
          issues.push({
            path: ["endsAt"],
            issue: "Cowork reservations must use the full-day duration.",
          });
        }

        if (
          reservation._tag === "meeting-room" &&
          !isWholeHourReservationInstant(interval.startsAt)
        )
          issues.push({
            path: ["startsAt"],
            issue: "Meeting room reservations must start on a whole hour.",
          });

        if (
          reservation._tag === "meeting-room" &&
          !isMeetingRoomReservationDuration(
            getReservationDurationMinutes(interval)
          )
        )
          issues.push({
            path: ["endsAt"],
            issue:
              "Meeting room duration must be 1 hour, 4 hours, or 24 hours.",
          });

        return issues;
      }
    )
  );

export const normalizeCheckoutReturnStateReservation = (
  reservation: CheckoutReturnStateReservationDraft
) =>
  normalizeReservationInterval(reservation).pipe(
    Effect.map((normalized) => ({
      ...reservation,
      startsAt: normalized.startsAt,
      endsAt: normalized.endsAt,
    }))
  );

export const checkoutReturnStateReservationEffectSchema =
  checkoutReturnStateReservationDraftEffectSchema.pipe(
    EffectSchema.decodeTo(CheckoutReturnStateReservationShapeSchema, {
      decode: SchemaGetter.transformOrFail((reservation) =>
        normalizeCheckoutReturnStateReservation(reservation).pipe(
          Effect.mapError(
            (error) =>
              new SchemaIssue.InvalidValue(Option.some(reservation), {
                message: error.message,
              })
          )
        )
      ),
      encode: SchemaGetter.transform(
        (reservation): CheckoutReturnStateReservationDraft => reservation
      ),
    })
  );

export const checkoutReturnStateReservationEffectParser =
  makeEffectSchemaParser(checkoutReturnStateReservationEffectSchema);

export type CheckoutReturnStateReservation =
  typeof checkoutReturnStateReservationEffectSchema.Type;

export const checkoutReturnStateReservationSchema = makeEffectSchemaParser(
  checkoutReturnStateReservationEffectSchema
);

export type CheckoutReturnStateReservationInput =
  WorkspaceCheckoutOrderInput & {
    readonly name: string;
    readonly email: string;
    readonly phone: string;
    readonly message?: string;
  };

const getCheckoutReturnStateReservationBase = (
  reservation: CheckoutReturnStateReservationInput,
  interval: { readonly startsAt: string; readonly endsAt: string }
) => ({
  startsAt: interval.startsAt,
  endsAt: interval.endsAt,
  name: reservation.name,
  email: reservation.email,
  phone: reservation.phone,
  ...(reservation.message !== undefined && { message: reservation.message }),
});

const toCheckoutReturnStateReservationPayload = (
  reservation: CheckoutReturnStateReservationInput
) => {
  const interval = unsafeNormalizeReservationInterval(reservation);
  const base = getCheckoutReturnStateReservationBase(reservation, interval);

  return {
    ...toWorkspaceCheckoutOrder(reservation),
    ...base,
    startsAt: interval.startsAt,
    endsAt: interval.endsAt,
  };
};

export const getCheckoutReturnStateReservation = (
  reservation: CheckoutReturnStateReservationInput
): CheckoutReturnStateReservation =>
  checkoutReturnStateReservationSchema.parse(
    toCheckoutReturnStateReservationPayload(reservation)
  );
