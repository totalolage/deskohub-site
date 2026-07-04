import { Effect } from "effect";
import { isValidPhoneNumber } from "libphonenumber-js";
import { z } from "zod/v4";
import {
  getWorkspaceProductByTier,
  type WorkspaceProductTier,
  workspaceProductMonitorOptions,
  workspaceProductTiers,
} from "@/features/checkout/product-catalog";
import { m } from "@/features/i18n";
import {
  getReservationIntervalValidationIssue,
  getReservationPragueDateRange,
  normalizeReservationInterval,
  reservationIntervalFieldSchemas,
} from "@/features/reservation/schemas/reservation-interval";
import { getReservationProductRuleIssue } from "@/features/reservation/schemas/reservation-product-rules";

export const RESERVATION_VALIDATION = {
  name: { min: 2, max: 100 },
  email: { max: 255 },
  phone: { max: 20 },
  message: { max: 1000 },
} as const;

const pragueDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Prague",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const getCurrentPragueDate = () => {
  const dateParts = Object.fromEntries(
    pragueDateFormatter
      .formatToParts(new Date())
      .map((part) => [part.type, part.value])
  );

  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
};

export const isTodayOrFuturePragueDate = (date: string) =>
  date >= getCurrentPragueDate();

const requiredEmailSchema = z
  .string()
  .trim()
  .min(1, { error: m.contactValidationEmailRequired() })
  .max(RESERVATION_VALIDATION.email.max, {
    error: m.contactValidationEmailMaximum({
      max: RESERVATION_VALIDATION.email.max,
    }),
  })
  .pipe(z.email({ error: m.contactValidationEmailInvalid() }));

const reservationOrderObjectSchema = () =>
  z.object({
    entryTier: z.enum(workspaceProductTiers, {
      error: m.reservationValidationTierRequired(),
    }),
    date: z.iso
      .date({ error: m.reservationValidationDateRequired() })
      .refine(isTodayOrFuturePragueDate, {
        error: m.reservationValidationDatePast(),
      }),
    ...reservationIntervalFieldSchemas,
    coffee: z.boolean(),
    monitorOption: z
      .enum(workspaceProductMonitorOptions)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    name: z
      .string()
      .trim()
      .min(RESERVATION_VALIDATION.name.min, {
        error: m.contactValidationNameMinimum({
          min: RESERVATION_VALIDATION.name.min,
        }),
      })
      .max(RESERVATION_VALIDATION.name.max, {
        error: m.contactValidationNameMaximum({
          max: RESERVATION_VALIDATION.name.max,
        }),
      }),
    email: requiredEmailSchema,
    phone: z
      .string()
      .trim()
      .min(1, { error: m.contactValidationPhoneRequired() })
      .max(RESERVATION_VALIDATION.phone.max, {
        error: m.contactValidationPhoneMaximum({
          max: RESERVATION_VALIDATION.phone.max,
        }),
      })
      .refine((phone) => isValidPhoneNumber(phone, "CZ"), {
        error: m.contactValidationPhoneInvalid(),
      }),
    message: z
      .string()
      .trim()
      .max(RESERVATION_VALIDATION.message.max, {
        error: m.contactValidationMessageMaximum({
          max: RESERVATION_VALIDATION.message.max,
        }),
      })
      .optional()
      .or(z.literal("")),
  });

const validateReservationOrder = (
  data: z.output<ReturnType<typeof reservationOrderObjectSchema>>,
  context: z.core.$RefinementCtx<
    z.output<ReturnType<typeof reservationOrderObjectSchema>>
  >
) => {
  const intervalIssue = getReservationIntervalValidationIssue(data);
  if (intervalIssue) {
    context.addIssue({
      code: "custom",
      path: [intervalIssue.path],
      message: intervalIssue.message,
    });
    return;
  }

  const productRuleIssue = getReservationProductRuleIssue(data);
  if (productRuleIssue) {
    context.addIssue({
      code: "custom",
      path: [productRuleIssue.path],
      message: productRuleIssue.message,
    });
    return;
  }

  if (data.entryTier === "meeting-room") {
    const range = Effect.runSync(getReservationPragueDateRange(data));
    if (range.startMs < Date.now()) {
      context.addIssue({
        code: "custom",
        path: ["startsAt"],
        message: m.reservationValidationDatePast(),
      });
      return;
    }
  }

  const product = getWorkspaceProductByTier(data.entryTier);

  if (product.requiresMonitorOption && !data.monitorOption) {
    context.addIssue({
      code: "custom",
      path: ["monitorOption"],
      message: m.reservationValidationMonitorRequired(),
    });
  }

  if (
    product.requiresMonitorOption &&
    data.monitorOption &&
    !product.allowedMonitorOptions.includes(data.monitorOption)
  ) {
    context.addIssue({
      code: "custom",
      path: ["monitorOption"],
      message: m.reservationValidationMonitorUnavailable(),
    });
  }

  if (!product.requiresMonitorOption && data.monitorOption) {
    context.addIssue({
      code: "custom",
      path: ["monitorOption"],
      message: m.reservationValidationMonitorUnavailable(),
    });
  }
};

const normalizeReservationOrder = <
  T extends { entryTier: WorkspaceProductTier; coffee: boolean },
>(
  data: T
) => {
  const product = getWorkspaceProductByTier(data.entryTier);
  const reservation = normalizeReservationInterval(data);

  return product.requiresCoffee
    ? { ...reservation, coffee: true }
    : reservation;
};

export const getReservationOrderSchema = () =>
  reservationOrderObjectSchema()
    .superRefine(validateReservationOrder)
    .transform(normalizeReservationOrder);

export const getReservationSchema = () =>
  reservationOrderObjectSchema()
    .extend({
      legalConsent: z.boolean().refine(Boolean, {
        error: m.reservationValidationLegalConsentRequired(),
      }),
    })
    .superRefine(validateReservationOrder)
    .transform(normalizeReservationOrder);

export type ReservationInput = z.input<ReturnType<typeof getReservationSchema>>;
export type ReservationData = z.output<ReturnType<typeof getReservationSchema>>;
export type ReservationOrderInput = z.input<
  ReturnType<typeof getReservationOrderSchema>
>;
export type ReservationOrderData = z.output<
  ReturnType<typeof getReservationOrderSchema>
>;

export const reservationDefaultValues: ReservationInput = {
  entryTier: "basic",
  date: "",
  startsAt: "00:00",
  endsAt: "24:00",
  coffee: false,
  monitorOption: undefined,
  name: "",
  email: "",
  phone: "",
  message: "",
  legalConsent: false,
};

export const tierIncludesCourtesyCoffee = (tier: WorkspaceProductTier) =>
  getWorkspaceProductByTier(tier).includesCourtesyCoffee;

export const tierRequiresMonitorOption = (tier: WorkspaceProductTier) =>
  getWorkspaceProductByTier(tier).requiresMonitorOption;

export const getAllowedMonitorOptionsForTier = (tier: WorkspaceProductTier) =>
  getWorkspaceProductByTier(tier).allowedMonitorOptions;
