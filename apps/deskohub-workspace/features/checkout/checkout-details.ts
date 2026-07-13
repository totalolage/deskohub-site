import { Data, Schema as EffectSchema, Match } from "effect";
import { checkoutSummarySectionEffectSchema } from "@/features/checkout/checkout-summary";
import { legalEvidenceMapEffectSchema } from "@/features/checkout/legal-evidence";
import { nonNegativeWorkspaceMoneyEffectSchema } from "@/features/checkout/workspace-money";
import { locales } from "@/features/i18n";
import {
  getReservationDurationMinutes,
  getReservationIntervalValidationIssue,
  isDefaultReservationInterval,
  meetingRoomReservationDurationMinutesEffectSchema,
  type ReservationInterval,
  wholeHourReservationInstantEffectSchema,
} from "@/features/reservation/reservation-interval";
import {
  type StoredCoworkReservationDetails,
  type StoredMeetingRoomReservationDetails,
  workspaceProductMonitorOptionEffectSchema,
} from "@/features/reservation/stored-reservation-details";
import { urlStringEffectSchema } from "@/shared/utils/effect-schema";
import { makeEffectSchemaParser } from "@/shared/utils/effect-schema-parser";
import { instantStringEffectSchema } from "@/shared/utils/temporal";

export class CheckoutDetailsError extends Data.TaggedError(
  "CheckoutDetailsError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const CheckoutDetailsReservationShapeSchema = EffectSchema.Union([
  EffectSchema.TaggedStruct("cowork", {
    tier: EffectSchema.Literal("basic"),
    coffee: EffectSchema.Boolean,
    startsAt: instantStringEffectSchema,
    endsAt: instantStringEffectSchema,
  }),
  EffectSchema.TaggedStruct("cowork", {
    tier: EffectSchema.Literal("plus"),
    coffee: EffectSchema.Literal(true),
    startsAt: instantStringEffectSchema,
    endsAt: instantStringEffectSchema,
  }),
  EffectSchema.TaggedStruct("cowork", {
    tier: EffectSchema.Literal("profi"),
    coffee: EffectSchema.Literal(true),
    monitorOption: workspaceProductMonitorOptionEffectSchema,
    startsAt: instantStringEffectSchema,
    endsAt: instantStringEffectSchema,
  }),
  EffectSchema.TaggedStruct("meeting-room", {
    startsAt: instantStringEffectSchema,
    endsAt: instantStringEffectSchema,
  }),
]);

type CheckoutDetailsReservationDraft =
  typeof CheckoutDetailsReservationShapeSchema.Type;

type CheckoutDetailsCoworkReservationDraft = Extract<
  CheckoutDetailsReservationDraft,
  { readonly _tag: "cowork" }
>;

type CheckoutDetailsMeetingRoomReservationDraft = Extract<
  CheckoutDetailsReservationDraft,
  { readonly _tag: "meeting-room" }
>;

const isMeetingRoomReservationDuration = EffectSchema.is(
  meetingRoomReservationDurationMinutesEffectSchema
);
const isWholeHourReservationInstant = EffectSchema.is(
  wholeHourReservationInstantEffectSchema
);

const getCheckoutDetailsCoworkReservationIssue = (
  reservation: CheckoutDetailsCoworkReservationDraft
): EffectSchema.FilterIssue | undefined => {
  return isDefaultReservationInterval(reservation)
    ? undefined
    : {
        path: ["endsAt"],
        issue: "Cowork reservations must use the full-day duration.",
      };
};

const getCheckoutDetailsMeetingRoomReservationIssue = (
  reservation: CheckoutDetailsMeetingRoomReservationDraft
): EffectSchema.FilterIssue | undefined => {
  if (!isWholeHourReservationInstant(reservation.startsAt)) {
    return {
      path: ["startsAt"],
      issue: "Meeting room reservations must start on a whole hour.",
    };
  }

  if (
    !isMeetingRoomReservationDuration(
      getReservationDurationMinutes(reservation)
    )
  ) {
    return {
      path: ["endsAt"],
      issue: "Meeting room duration must be 1 hour, 4 hours, or 24 hours.",
    };
  }

  return undefined;
};

const getCheckoutDetailsReservationIssue = (
  reservation: CheckoutDetailsReservationDraft
): EffectSchema.FilterIssue | undefined => {
  const intervalIssue = getReservationIntervalValidationIssue(reservation);
  if (intervalIssue) {
    return {
      path: [intervalIssue.path],
      issue: intervalIssue.message,
    };
  }

  return Match.value(reservation).pipe(
    Match.tag("cowork", getCheckoutDetailsCoworkReservationIssue),
    Match.tag("meeting-room", getCheckoutDetailsMeetingRoomReservationIssue),
    Match.exhaustive
  );
};

const getCheckoutDetailsReservationIssues = (
  reservation: CheckoutDetailsReservationDraft
): readonly EffectSchema.FilterIssue[] => {
  const issue = getCheckoutDetailsReservationIssue(reservation);
  return issue ? [issue] : [];
};

const checkoutDetailsReservationEffectSchema =
  CheckoutDetailsReservationShapeSchema.check(
    EffectSchema.makeFilter(getCheckoutDetailsReservationIssues)
  );

export const checkoutDetailsReservationSchema = makeEffectSchemaParser(
  checkoutDetailsReservationEffectSchema
);

export type CheckoutDetailsReservation =
  typeof checkoutDetailsReservationEffectSchema.Type;

type CheckoutDetailsReservationInput =
  | StoredCoworkReservationDetails
  | (StoredMeetingRoomReservationDetails & ReservationInterval);

export const parseCheckoutDetailsReservation = (
  reservation: CheckoutDetailsReservationInput,
  interval: ReservationInterval
): CheckoutDetailsReservation =>
  checkoutDetailsReservationSchema.parse({
    ...reservation,
    startsAt: interval.startsAt,
    endsAt: interval.endsAt,
  });

const checkoutDetailsPaymentCustomerDiscountEffectSchema = EffectSchema.Struct({
  source: EffectSchema.Literal("dotypos-discount-group"),
  discountGroupId: EffectSchema.NonEmptyString,
  percent: EffectSchema.Finite.check(
    EffectSchema.isGreaterThan(0),
    EffectSchema.isLessThanOrEqualTo(100)
  ),
  amount: nonNegativeWorkspaceMoneyEffectSchema,
});

// This JSON is intentionally limited to booking, payment, legal, and fulfillment
// state. Customer name, email, and phone remain owned by Dotypos and must not be
// added here or as local database columns.
export const checkoutDetailsJsonEffectSchema = EffectSchema.Struct({
  locale: EffectSchema.Literals(locales),
  reservation: checkoutDetailsReservationEffectSchema,
  payment: EffectSchema.Struct({
    expectedPrice: nonNegativeWorkspaceMoneyEffectSchema,
    undiscountedPrice: EffectSchema.optional(
      nonNegativeWorkspaceMoneyEffectSchema
    ),
    summary: EffectSchema.Struct({
      sections: EffectSchema.Array(checkoutSummarySectionEffectSchema),
      total: nonNegativeWorkspaceMoneyEffectSchema,
    }),
    providerRedirectUrl: EffectSchema.optional(urlStringEffectSchema),
    customerDiscount: EffectSchema.optional(
      checkoutDetailsPaymentCustomerDiscountEffectSchema
    ),
  }),
  legal: legalEvidenceMapEffectSchema,
  fulfillment: EffectSchema.Struct({
    accessCodePolicy: EffectSchema.Literal("workspace-static-v1"),
  }),
});

export type CheckoutDetailsJson = typeof checkoutDetailsJsonEffectSchema.Type;

export const checkoutDetailsJsonSchema = makeEffectSchemaParser(
  checkoutDetailsJsonEffectSchema
);
