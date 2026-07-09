import { Schema as EffectSchema, Option } from "effect";
import { isValidPhoneNumber } from "libphonenumber-js";
import { z } from "zod/v4";
import {
  getWorkspaceProductByTier,
  type WorkspaceProductMonitorOption,
  workspaceCoworkProductTiers,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import {
  getReservationProductMonitorOption,
  RESERVATION_VALIDATION,
} from "@/features/reservation/schemas/reservation";
import {
  getReservationIntervalValidationIssue,
  unsafeNormalizeReservationInterval,
} from "@/features/reservation/schemas/reservation-interval";
import { getReservationProductRuleIssue } from "@/features/reservation/schemas/reservation-product-rules";

const CheckoutReturnStateReservationBaseSchema = EffectSchema.Struct({
  startsAt: EffectSchema.NonEmptyString,
  endsAt: EffectSchema.NonEmptyString,
  name: EffectSchema.NonEmptyString,
  email: EffectSchema.NonEmptyString,
  phone: EffectSchema.NonEmptyString,
  message: EffectSchema.optional(EffectSchema.String),
});

type CheckoutReturnStateReservationBase =
  typeof CheckoutReturnStateReservationBaseSchema.Type;
type CheckoutReturnStateReservationDraft =
  | (CheckoutReturnStateReservationBase & {
      readonly entryTier: (typeof workspaceCoworkProductTiers)[number];
      readonly coffee: boolean;
      readonly monitorOption?: WorkspaceProductMonitorOption;
    })
  | (CheckoutReturnStateReservationBase & {
      readonly entryTier: "meeting-room";
    });

const CheckoutReturnStateReservationSchema = EffectSchema.Union([
  EffectSchema.Struct({
    ...CheckoutReturnStateReservationBaseSchema.fields,
    entryTier: EffectSchema.Literals(workspaceCoworkProductTiers),
    coffee: EffectSchema.Boolean,
    monitorOption: EffectSchema.optional(
      EffectSchema.Literals(workspaceProductMonitorOptions)
    ),
  }),
  EffectSchema.Struct({
    ...CheckoutReturnStateReservationBaseSchema.fields,
    entryTier: EffectSchema.Literal("meeting-room"),
  }),
]);

const decodeCheckoutReturnStateReservation = EffectSchema.decodeUnknownOption(
  CheckoutReturnStateReservationSchema
);

const checkoutReturnStateReservationInputSchema =
  z.custom<CheckoutReturnStateReservationDraft>((value) =>
    Option.isSome(decodeCheckoutReturnStateReservation(value))
  );
type CheckoutReturnStateReservation =
  | (CheckoutReturnStateReservationBase & {
      readonly entryTier: (typeof workspaceCoworkProductTiers)[number];
      readonly coffee: boolean;
      readonly monitorOption?: WorkspaceProductMonitorOption;
    })
  | (CheckoutReturnStateReservationBase & {
      readonly entryTier: "meeting-room";
    });

const validateCheckoutReturnStateReservation = (
  reservation: CheckoutReturnStateReservationDraft,
  context: z.core.$RefinementCtx<CheckoutReturnStateReservationDraft>
) => {
  if (
    reservation.name.trim().length < RESERVATION_VALIDATION.name.min ||
    reservation.name.trim().length > RESERVATION_VALIDATION.name.max
  ) {
    context.addIssue({
      code: "custom",
      path: ["name"],
      message: "Invalid reservation customer name.",
    });
    return;
  }

  if (
    reservation.email.trim().length > RESERVATION_VALIDATION.email.max ||
    !z.email().safeParse(reservation.email.trim()).success
  ) {
    context.addIssue({
      code: "custom",
      path: ["email"],
      message: "Invalid reservation customer email.",
    });
    return;
  }

  if (
    reservation.phone.trim().length > RESERVATION_VALIDATION.phone.max ||
    !isValidPhoneNumber(reservation.phone.trim(), "CZ")
  ) {
    context.addIssue({
      code: "custom",
      path: ["phone"],
      message: "Invalid reservation customer phone.",
    });
    return;
  }

  if (
    reservation.message &&
    reservation.message.trim().length > RESERVATION_VALIDATION.message.max
  ) {
    context.addIssue({
      code: "custom",
      path: ["message"],
      message: "Invalid reservation message.",
    });
    return;
  }

  const intervalIssue = getReservationIntervalValidationIssue(reservation);
  if (intervalIssue) {
    context.addIssue({
      code: "custom",
      path: [intervalIssue.path],
      message: intervalIssue.message,
    });
    return;
  }

  const productRuleIssue = getReservationProductRuleIssue(reservation);
  if (productRuleIssue) {
    context.addIssue({
      code: "custom",
      path: [productRuleIssue.path],
      message: productRuleIssue.message,
    });
    return;
  }

  if (reservation.entryTier === "meeting-room") return;

  const product = getWorkspaceProductByTier(reservation.entryTier);
  const monitorOption = getReservationProductMonitorOption(reservation);

  if (product.requiresMonitorOption && !monitorOption) {
    context.addIssue({
      code: "custom",
      path: ["monitorOption"],
      message: "Monitor option is required for this entry tier.",
    });
  }

  if (
    product.requiresMonitorOption &&
    monitorOption &&
    !product.allowedMonitorOptions.includes(monitorOption)
  ) {
    context.addIssue({
      code: "custom",
      path: ["monitorOption"],
      message: "Monitor option is unavailable for this entry tier.",
    });
  }

  if (!product.requiresMonitorOption && monitorOption) {
    context.addIssue({
      code: "custom",
      path: ["monitorOption"],
      message: "Monitor option is unavailable for this entry tier.",
    });
  }
};

const normalizeCheckoutReturnStateReservation = (
  reservation: CheckoutReturnStateReservationDraft
): CheckoutReturnStateReservation => {
  if (reservation.entryTier === "meeting-room") {
    return unsafeNormalizeReservationInterval(reservation);
  }

  const product = getWorkspaceProductByTier(reservation.entryTier);
  const normalizedReservation = unsafeNormalizeReservationInterval(reservation);

  return product.requiresCoffee
    ? { ...normalizedReservation, coffee: true }
    : normalizedReservation;
};

export const checkoutReturnStateReservationSchema =
  checkoutReturnStateReservationInputSchema
    .superRefine(validateCheckoutReturnStateReservation)
    .transform(normalizeCheckoutReturnStateReservation);

export const checkoutReturnStateJsonSchema = z.object({
  schema: z.literal("workspace-checkout-return-state"),
  schemaVersion: z.literal(1),
  reservation: checkoutReturnStateReservationSchema,
});

export type CheckoutReturnStateJson = z.output<
  typeof checkoutReturnStateJsonSchema
>;
