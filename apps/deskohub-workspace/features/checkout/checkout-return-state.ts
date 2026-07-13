import { Schema as EffectSchema } from "effect";
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
  type ReservationInterval,
  wholeHourReservationInstantEffectSchema,
} from "@/features/reservation/reservation-interval";
import { workspaceProductMonitorOptionEffectSchema } from "@/features/reservation/stored-reservation-details";
import { makeEffectSchemaParser } from "@/shared/utils/effect-schema-parser";
import { instantStringEffectSchema } from "@/shared/utils/temporal";

const checkoutReturnStateReservationBaseEffectFields = {
  startsAt: instantStringEffectSchema,
  endsAt: instantStringEffectSchema,
  name: reservationCustomerNameEffectSchema,
  email: reservationCustomerEmailEffectSchema,
  phone: reservationCustomerPhoneEffectSchema,
  message: EffectSchema.optional(reservationCustomerMessageEffectSchema),
};

const CheckoutReturnStateReservationShapeSchema = EffectSchema.Union([
  EffectSchema.TaggedStruct("cowork", {
    ...checkoutReturnStateReservationBaseEffectFields,
    tier: EffectSchema.Literal("basic"),
    coffee: EffectSchema.Boolean,
  }),
  EffectSchema.TaggedStruct("cowork", {
    ...checkoutReturnStateReservationBaseEffectFields,
    tier: EffectSchema.Literal("plus"),
    coffee: EffectSchema.Literal(true),
  }),
  EffectSchema.TaggedStruct("cowork", {
    ...checkoutReturnStateReservationBaseEffectFields,
    tier: EffectSchema.Literal("profi"),
    coffee: EffectSchema.Literal(true),
    monitorOption: workspaceProductMonitorOptionEffectSchema,
  }),
  EffectSchema.TaggedStruct("meeting-room", {
    ...checkoutReturnStateReservationBaseEffectFields,
  }),
]);

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

        const issues: Array<{
          readonly path: readonly PropertyKey[];
          readonly issue: string;
        }> = [];

        if (
          reservation._tag === "cowork" &&
          !isDefaultReservationInterval(reservation)
        ) {
          issues.push({
            path: ["endsAt"],
            issue: "Cowork reservations must use the full-day duration.",
          });
        }

        if (
          reservation._tag === "meeting-room" &&
          !isWholeHourReservationInstant(reservation.startsAt)
        )
          issues.push({
            path: ["startsAt"],
            issue: "Meeting room reservations must start on a whole hour.",
          });

        if (
          reservation._tag === "meeting-room" &&
          !isMeetingRoomReservationDuration(
            getReservationDurationMinutes(reservation)
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

export const checkoutReturnStateReservationEffectSchema =
  checkoutReturnStateReservationDraftEffectSchema;

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
  interval: ReservationInterval
) => ({
  startsAt: interval.startsAt,
  endsAt: interval.endsAt,
  name: reservation.name,
  email: reservation.email,
  phone: reservation.phone,
  ...(reservation.message !== undefined && { message: reservation.message }),
});

const toCheckoutReturnStateReservationPayload = (
  reservation: CheckoutReturnStateReservationInput,
  interval: ReservationInterval
) => {
  const base = getCheckoutReturnStateReservationBase(reservation, interval);

  return {
    ...toWorkspaceCheckoutOrder(reservation, interval),
    ...base,
    startsAt: interval.startsAt,
    endsAt: interval.endsAt,
  };
};

export const getCheckoutReturnStateReservation = (
  reservation: CheckoutReturnStateReservationInput,
  interval: ReservationInterval
): CheckoutReturnStateReservation =>
  checkoutReturnStateReservationSchema.parse(
    toCheckoutReturnStateReservationPayload(reservation, interval)
  );
