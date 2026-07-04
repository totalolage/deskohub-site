import { isValidPhoneNumber } from "libphonenumber-js";
import { z } from "zod/v4";
import {
  getWorkspaceProductByTier,
  workspaceCoworkProductTiers,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import { RESERVATION_VALIDATION } from "@/features/reservation/schemas/reservation";
import {
  getReservationIntervalValidationIssue,
  normalizeReservationInterval,
  reservationIntervalFieldSchemas,
} from "@/features/reservation/schemas/reservation-interval";

const checkoutReturnStateReservationBaseSchema = z.object({
  date: z.iso.date(),
  ...reservationIntervalFieldSchemas,
  coffee: z.boolean(),
  monitorOption: z
    .enum(workspaceProductMonitorOptions)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  name: z
    .string()
    .trim()
    .min(RESERVATION_VALIDATION.name.min)
    .max(RESERVATION_VALIDATION.name.max),
  email: z
    .string()
    .trim()
    .max(RESERVATION_VALIDATION.email.max)
    .pipe(z.email()),
  phone: z
    .string()
    .trim()
    .min(1)
    .max(RESERVATION_VALIDATION.phone.max)
    .refine((phone) => isValidPhoneNumber(phone, "CZ")),
  message: z
    .string()
    .trim()
    .max(RESERVATION_VALIDATION.message.max)
    .optional()
    .or(z.literal("")),
});

const validateCheckoutReturnStateReservation = (
  reservation: z.output<typeof checkoutReturnStateReservationBaseSchema> & {
    readonly entryTier:
      | "meeting-room"
      | (typeof workspaceCoworkProductTiers)[number];
  },
  context: z.core.$RefinementCtx<
    z.output<typeof checkoutReturnStateReservationBaseSchema> & {
      readonly entryTier:
        | "meeting-room"
        | (typeof workspaceCoworkProductTiers)[number];
    }
  >
) => {
  const intervalIssue = getReservationIntervalValidationIssue(reservation);
  if (intervalIssue) {
    context.addIssue({
      code: "custom",
      path: [intervalIssue.path],
      message: intervalIssue.message,
    });
  }

  const product = getWorkspaceProductByTier(reservation.entryTier);

  if (product.requiresMonitorOption && !reservation.monitorOption) {
    context.addIssue({
      code: "custom",
      path: ["monitorOption"],
      message: "Monitor option is required for this entry tier.",
    });
  }

  if (
    product.requiresMonitorOption &&
    reservation.monitorOption &&
    !product.allowedMonitorOptions.includes(reservation.monitorOption)
  ) {
    context.addIssue({
      code: "custom",
      path: ["monitorOption"],
      message: "Monitor option is unavailable for this entry tier.",
    });
  }

  if (!product.requiresMonitorOption && reservation.monitorOption) {
    context.addIssue({
      code: "custom",
      path: ["monitorOption"],
      message: "Monitor option is unavailable for this entry tier.",
    });
  }
};

const normalizeCheckoutReturnStateReservation = <
  T extends {
    readonly entryTier:
      | "meeting-room"
      | (typeof workspaceCoworkProductTiers)[number];
    readonly coffee: boolean;
  },
>(
  reservation: T
) => {
  const product = getWorkspaceProductByTier(reservation.entryTier);
  const normalizedReservation = normalizeReservationInterval(reservation);
  return product.requiresCoffee
    ? { ...normalizedReservation, coffee: true }
    : normalizedReservation;
};

export const coworkCheckoutReturnStateReservationSchema =
  checkoutReturnStateReservationBaseSchema
    .extend({
      entryTier: z.enum(workspaceCoworkProductTiers),
    })
    .superRefine(validateCheckoutReturnStateReservation)
    .transform(normalizeCheckoutReturnStateReservation);

export const meetingRoomCheckoutReturnStateReservationSchema =
  checkoutReturnStateReservationBaseSchema
    .extend({
      entryTier: z.literal("meeting-room"),
    })
    .superRefine(validateCheckoutReturnStateReservation)
    .transform(normalizeCheckoutReturnStateReservation);

export const checkoutReturnStateReservationSchema = z.union([
  coworkCheckoutReturnStateReservationSchema,
  meetingRoomCheckoutReturnStateReservationSchema,
]);

export const checkoutReturnStateJsonSchema = z.object({
  schema: z.literal("workspace-checkout-return-state"),
  schemaVersion: z.literal(1),
  reservation: checkoutReturnStateReservationSchema,
});

export type CheckoutReturnStateJson = z.output<
  typeof checkoutReturnStateJsonSchema
>;
