import { isValidPhoneNumber } from "libphonenumber-js";
import { z } from "zod/v4";
import {
  getWorkspaceProductByTier,
  workspaceProductMonitorOptions,
  workspaceProductTiers,
} from "@/features/checkout/product-catalog";
import { RESERVATION_VALIDATION } from "@/features/reservation/schemas/reservation";

const checkoutReturnStateReservationSchema = z
  .object({
    entryTier: z.enum(workspaceProductTiers),
    date: z.iso.date(),
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
  })
  .superRefine((reservation, context) => {
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
  })
  .transform((reservation) => {
    const product = getWorkspaceProductByTier(reservation.entryTier);
    return product.requiresCoffee
      ? { ...reservation, coffee: true }
      : reservation;
  });

export const checkoutReturnStateJsonSchema = z.object({
  schema: z.literal("workspace-checkout-return-state"),
  schemaVersion: z.literal(1),
  reservation: checkoutReturnStateReservationSchema,
});

export type CheckoutReturnStateJson = z.output<
  typeof checkoutReturnStateJsonSchema
>;
