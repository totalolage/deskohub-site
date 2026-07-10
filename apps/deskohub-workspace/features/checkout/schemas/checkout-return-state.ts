import { Schema as EffectSchema, Match } from "effect";
import type { WorkspaceCheckoutOrderInput } from "@/features/checkout/checkout-quote";
import {
  reservationCustomerEmailEffectSchema,
  reservationCustomerMessageEffectSchema,
  reservationCustomerNameEffectSchema,
  reservationCustomerPhoneEffectSchema,
} from "@/features/reservation/schemas/reservation";
import {
  getReservationIntervalValidationIssue,
  unsafeNormalizeReservationInterval,
} from "@/features/reservation/schemas/reservation-interval";
import {
  getReservationProductRuleIssue,
  ReservationProductRuleInput,
} from "@/features/reservation/schemas/reservation-product-rules";
import { makeWorkspaceReservationDetailsEffectSchema } from "@/features/reservation/schemas/stored-reservation-details";
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

const getCheckoutReturnStateReservationProductRuleInput = (
  reservation: CheckoutReturnStateReservationDraft
) =>
  Match.value(reservation).pipe(
    Match.tag("meeting-room", (meetingRoomReservation) =>
      ReservationProductRuleInput["meeting-room"]({
        startsAt: meetingRoomReservation.startsAt,
        endsAt: meetingRoomReservation.endsAt,
      })
    ),
    Match.when({ _tag: "cowork", tier: "basic" }, (coworkReservation) =>
      ReservationProductRuleInput.cowork({
        tier: "basic" as const,
        coffee: coworkReservation.coffee,
        startsAt: coworkReservation.startsAt,
        endsAt: coworkReservation.endsAt,
      })
    ),
    Match.when({ _tag: "cowork", tier: "plus" }, (coworkReservation) =>
      ReservationProductRuleInput.cowork({
        tier: "plus" as const,
        coffee: coworkReservation.coffee,
        startsAt: coworkReservation.startsAt,
        endsAt: coworkReservation.endsAt,
      })
    ),
    Match.when({ _tag: "cowork", tier: "profi" }, (coworkReservation) =>
      ReservationProductRuleInput.cowork({
        tier: "profi" as const,
        coffee: coworkReservation.coffee,
        monitorOption: coworkReservation.monitorOption,
        startsAt: coworkReservation.startsAt,
        endsAt: coworkReservation.endsAt,
      })
    ),
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
            path: [
              productRuleIssue.path === "entryTier"
                ? "tier"
                : productRuleIssue.path,
            ],
            issue: productRuleIssue.message,
          });
        }

        return issues;
      }
    )
  );

export const checkoutReturnStateReservationEffectParser =
  makeEffectSchemaParser(checkoutReturnStateReservationEffectSchema);

export const normalizeCheckoutReturnStateReservation = (
  reservation: CheckoutReturnStateReservationDraft
) =>
  Match.value(reservation).pipe(
    Match.tag("meeting-room", (meetingRoomReservation) =>
      unsafeNormalizeReservationInterval(meetingRoomReservation)
    ),
    Match.when({ _tag: "cowork", tier: "basic" }, (basicReservation) =>
      unsafeNormalizeReservationInterval(basicReservation)
    ),
    Match.when({ _tag: "cowork", tier: "plus" }, (plusReservation) => ({
      ...unsafeNormalizeReservationInterval(plusReservation),
      coffee: true as const,
    })),
    Match.when({ _tag: "cowork", tier: "profi" }, (profiReservation) => ({
      ...unsafeNormalizeReservationInterval(profiReservation),
      coffee: true as const,
      monitorOption: profiReservation.monitorOption,
    })),
    Match.exhaustive
  );

export type CheckoutReturnStateReservation = ReturnType<
  typeof normalizeCheckoutReturnStateReservation
>;

export const checkoutReturnStateReservationSchema = {
  parse: (input: unknown): CheckoutReturnStateReservation =>
    normalizeCheckoutReturnStateReservation(
      checkoutReturnStateReservationEffectParser.parse(input)
    ),
  safeParse: (input: unknown) => {
    try {
      return {
        success: true as const,
        data: checkoutReturnStateReservationSchema.parse(input),
      };
    } catch (error) {
      return { success: false as const, error };
    }
  },
};

export type CheckoutReturnStateReservationInput =
  WorkspaceCheckoutOrderInput & {
    readonly name: string;
    readonly email: string;
    readonly phone: string;
    readonly message?: string;
  };

const getCheckoutReturnStateReservationBase = (
  reservation: CheckoutReturnStateReservationInput
) => ({
  startsAt: reservation.startsAt,
  endsAt: reservation.endsAt,
  name: reservation.name,
  email: reservation.email,
  phone: reservation.phone,
  ...(reservation.message !== undefined && { message: reservation.message }),
});

const toCheckoutReturnStateReservationPayload = (
  reservation: CheckoutReturnStateReservationInput
) =>
  Match.value(reservation).pipe(
    Match.when({ entryTier: "meeting-room" }, (meetingRoomReservation) => ({
      _tag: "meeting-room" as const,
      ...getCheckoutReturnStateReservationBase(meetingRoomReservation),
    })),
    Match.when({ entryTier: "basic" }, (coworkReservation) => ({
      _tag: "cowork" as const,
      tier: "basic" as const,
      ...getCheckoutReturnStateReservationBase(coworkReservation),
      coffee: coworkReservation.coffee,
    })),
    Match.when({ entryTier: "plus" }, (coworkReservation) => ({
      _tag: "cowork" as const,
      tier: "plus" as const,
      ...getCheckoutReturnStateReservationBase(coworkReservation),
      coffee: true as const,
    })),
    Match.when({ entryTier: "profi" }, (coworkReservation) => ({
      _tag: "cowork" as const,
      tier: "profi" as const,
      ...getCheckoutReturnStateReservationBase(coworkReservation),
      coffee: true as const,
      monitorOption: coworkReservation.monitorOption,
    })),
    Match.exhaustive
  );

export const getCheckoutReturnStateReservation = (
  reservation: CheckoutReturnStateReservationInput
): CheckoutReturnStateReservation =>
  checkoutReturnStateReservationSchema.parse(
    toCheckoutReturnStateReservationPayload(reservation)
  );

export const checkoutReturnStateJsonEffectSchema = EffectSchema.Struct({
  schema: EffectSchema.Literal("workspace-checkout-return-state"),
  schemaVersion: EffectSchema.Literal(1),
  reservation: checkoutReturnStateReservationEffectSchema,
});

type CheckoutReturnStateJsonDraft =
  typeof checkoutReturnStateJsonEffectSchema.Type;

export type CheckoutReturnStateJson = Omit<
  CheckoutReturnStateJsonDraft,
  "reservation"
> & {
  readonly reservation: CheckoutReturnStateReservation;
};

const checkoutReturnStateJsonEffectParser = makeEffectSchemaParser(
  checkoutReturnStateJsonEffectSchema
);

const normalizeCheckoutReturnStateJson = (
  details: CheckoutReturnStateJsonDraft
): CheckoutReturnStateJson => ({
  ...details,
  reservation: normalizeCheckoutReturnStateReservation(details.reservation),
});

export const checkoutReturnStateJsonSchema = {
  parse: (input: unknown): CheckoutReturnStateJson =>
    normalizeCheckoutReturnStateJson(
      checkoutReturnStateJsonEffectParser.parse(input)
    ),
  safeParse: (input: unknown) => {
    try {
      return {
        success: true as const,
        data: checkoutReturnStateJsonSchema.parse(input),
      };
    } catch (error) {
      return { success: false as const, error };
    }
  },
};
