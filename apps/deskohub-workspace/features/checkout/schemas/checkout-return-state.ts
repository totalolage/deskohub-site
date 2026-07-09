import { Schema as EffectSchema, Match, Option } from "effect";
import { isValidPhoneNumber } from "libphonenumber-js";
import { z } from "zod/v4";
import { RESERVATION_VALIDATION } from "@/features/reservation/schemas/reservation";
import {
  getReservationIntervalValidationIssue,
  unsafeNormalizeReservationInterval,
} from "@/features/reservation/schemas/reservation-interval";
import { getReservationProductRuleIssue } from "@/features/reservation/schemas/reservation-product-rules";
import { workspaceProductMonitorOptionEffectSchema } from "@/features/reservation/schemas/stored-reservation-details";
import { makeEffectSchemaParser } from "@/shared/utils/effect-schema-parser";

const CheckoutReturnStateReservationBaseSchema = EffectSchema.Struct({
  startsAt: EffectSchema.NonEmptyString,
  endsAt: EffectSchema.NonEmptyString,
  name: EffectSchema.NonEmptyString,
  email: EffectSchema.NonEmptyString,
  phone: EffectSchema.NonEmptyString,
  message: EffectSchema.optional(EffectSchema.String),
});

const CheckoutReturnStateReservationShapeSchema = EffectSchema.Union([
  EffectSchema.Struct({
    ...CheckoutReturnStateReservationBaseSchema.fields,
    entryTier: EffectSchema.Literal("basic"),
    coffee: EffectSchema.Boolean,
  }),
  EffectSchema.Struct({
    ...CheckoutReturnStateReservationBaseSchema.fields,
    entryTier: EffectSchema.Literal("plus"),
    coffee: EffectSchema.Literal(true),
  }),
  EffectSchema.Struct({
    ...CheckoutReturnStateReservationBaseSchema.fields,
    entryTier: EffectSchema.Literal("profi"),
    coffee: EffectSchema.Literal(true),
    monitorOption: workspaceProductMonitorOptionEffectSchema,
  }),
  EffectSchema.Struct({
    ...CheckoutReturnStateReservationBaseSchema.fields,
    entryTier: EffectSchema.Literal("meeting-room"),
  }),
]);

type CheckoutReturnStateReservationDraft =
  typeof CheckoutReturnStateReservationShapeSchema.Type;

const getCheckoutReturnStateReservationProductRuleInput = (
  reservation: CheckoutReturnStateReservationDraft
) =>
  Match.value(reservation).pipe(
    Match.when({ entryTier: "meeting-room" }, (meetingRoomReservation) => ({
      _tag: "meeting-room" as const,
      startsAt: meetingRoomReservation.startsAt,
      endsAt: meetingRoomReservation.endsAt,
    })),
    Match.when({ entryTier: "basic" }, (coworkReservation) => ({
      _tag: "cowork" as const,
      tier: "basic" as const,
      coffee: coworkReservation.coffee,
      startsAt: coworkReservation.startsAt,
      endsAt: coworkReservation.endsAt,
    })),
    Match.when({ entryTier: "plus" }, (coworkReservation) => ({
      _tag: "cowork" as const,
      tier: "plus" as const,
      coffee: coworkReservation.coffee,
      startsAt: coworkReservation.startsAt,
      endsAt: coworkReservation.endsAt,
    })),
    Match.when({ entryTier: "profi" }, (coworkReservation) => ({
      _tag: "cowork" as const,
      tier: "profi" as const,
      coffee: coworkReservation.coffee,
      monitorOption: coworkReservation.monitorOption,
      startsAt: coworkReservation.startsAt,
      endsAt: coworkReservation.endsAt,
    })),
    Match.exhaustive
  );

export const checkoutReturnStateReservationEffectSchema =
  CheckoutReturnStateReservationShapeSchema.check(
    EffectSchema.makeFilter<CheckoutReturnStateReservationDraft>(
      (reservation) => {
        const issues: Array<{
          readonly path: readonly PropertyKey[];
          readonly issue: string;
        }> = [];

        if (
          reservation.name.trim().length < RESERVATION_VALIDATION.name.min ||
          reservation.name.trim().length > RESERVATION_VALIDATION.name.max
        ) {
          issues.push({
            path: ["name"],
            issue: "Invalid reservation customer name.",
          });
        }

        if (
          reservation.email.trim().length > RESERVATION_VALIDATION.email.max ||
          !z.email().safeParse(reservation.email.trim()).success
        ) {
          issues.push({
            path: ["email"],
            issue: "Invalid reservation customer email.",
          });
        }

        if (
          reservation.phone.trim().length > RESERVATION_VALIDATION.phone.max ||
          !isValidPhoneNumber(reservation.phone.trim(), "CZ")
        ) {
          issues.push({
            path: ["phone"],
            issue: "Invalid reservation customer phone.",
          });
        }

        if (
          reservation.message &&
          reservation.message.trim().length > RESERVATION_VALIDATION.message.max
        ) {
          issues.push({
            path: ["message"],
            issue: "Invalid reservation message.",
          });
        }

        const intervalIssue =
          getReservationIntervalValidationIssue(reservation);
        if (intervalIssue) {
          issues.push({
            path: [intervalIssue.path],
            issue: intervalIssue.message,
          });
        }

        const productRuleIssue = getReservationProductRuleIssue(
          getCheckoutReturnStateReservationProductRuleInput(reservation)
        );
        if (productRuleIssue) {
          issues.push({
            path: [productRuleIssue.path],
            issue: productRuleIssue.message,
          });
        }

        return issues;
      }
    )
  );

const decodeCheckoutReturnStateReservation = EffectSchema.decodeUnknownOption(
  checkoutReturnStateReservationEffectSchema
);

export const checkoutReturnStateReservationEffectParser =
  makeEffectSchemaParser(checkoutReturnStateReservationEffectSchema);

const checkoutReturnStateReservationInputSchema =
  z.custom<CheckoutReturnStateReservationDraft>((value) =>
    Option.isSome(decodeCheckoutReturnStateReservation(value))
  );
export type CheckoutReturnStateReservation =
  CheckoutReturnStateReservationDraft;

export const normalizeCheckoutReturnStateReservation = (
  reservation: CheckoutReturnStateReservationDraft
): CheckoutReturnStateReservation =>
  Match.value(reservation).pipe(
    Match.when({ entryTier: "meeting-room" }, (meetingRoomReservation) =>
      unsafeNormalizeReservationInterval(meetingRoomReservation)
    ),
    Match.when({ entryTier: "basic" }, (basicReservation) =>
      unsafeNormalizeReservationInterval(basicReservation)
    ),
    Match.when({ entryTier: "plus" }, (plusReservation) => ({
      ...unsafeNormalizeReservationInterval(plusReservation),
      coffee: true as const,
    })),
    Match.when({ entryTier: "profi" }, (profiReservation) => ({
      ...unsafeNormalizeReservationInterval(profiReservation),
      coffee: true as const,
      monitorOption: profiReservation.monitorOption,
    })),
    Match.exhaustive
  );

export const checkoutReturnStateReservationSchema =
  checkoutReturnStateReservationInputSchema.transform(
    normalizeCheckoutReturnStateReservation
  );

export const checkoutReturnStateJsonSchema = z.object({
  schema: z.literal("workspace-checkout-return-state"),
  schemaVersion: z.literal(1),
  reservation: checkoutReturnStateReservationSchema,
});

export type CheckoutReturnStateJson = z.output<
  typeof checkoutReturnStateJsonSchema
>;
