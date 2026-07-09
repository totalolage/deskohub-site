import "@/shared/polyfills/temporal";

import { Effect, Match } from "effect";
import { isValidPhoneNumber } from "libphonenumber-js";
import { z } from "zod/v4";
import {
  getWorkspaceProductByTier,
  type WorkspaceCoworkProductTier,
  type WorkspaceProductMonitorOption,
  workspaceCoworkProductTiers,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import { m } from "@/features/i18n";
import {
  getReservationIntervalValidationIssue,
  getReservationPragueDateRange,
  type ReservationInterval,
  reservationIntervalFieldSchemas,
  unsafeNormalizeReservationInterval,
} from "@/features/reservation/schemas/reservation-interval";
import { getReservationProductRuleIssue } from "@/features/reservation/schemas/reservation-product-rules";

export const RESERVATION_VALIDATION = {
  name: { min: 2, max: 100 },
  email: { max: 255 },
  phone: { max: 20 },
  message: { max: 1000 },
} as const;

const getCurrentPragueDate = () =>
  Temporal.Now.zonedDateTimeISO("Europe/Prague").toPlainDate().toString();

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

const reservationOrderBaseShape = {
  ...reservationIntervalFieldSchemas,
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
} as const;

const reservationFormDateShape = {
  date: z.iso
    .date({ error: m.reservationValidationDateRequired() })
    .refine(isTodayOrFuturePragueDate, {
      error: m.reservationValidationDatePast(),
    }),
} as const;

const coworkReservationOrderObjectSchema = () =>
  z.object({
    ...reservationOrderBaseShape,
    entryTier: z.enum(workspaceCoworkProductTiers, {
      error: m.reservationValidationTierRequired(),
    }),
    coffee: z.boolean(),
    monitorOption: z
      .enum(workspaceProductMonitorOptions)
      .optional()
      .or(z.literal("").transform(() => undefined)),
  });

const meetingRoomReservationOrderObjectSchema = () =>
  z.object({
    ...reservationOrderBaseShape,
    entryTier: z.literal("meeting-room"),
  });

const reservationOrderObjectSchema = () =>
  z.union([
    coworkReservationOrderObjectSchema(),
    meetingRoomReservationOrderObjectSchema(),
  ]);

type ReservationOrderObject = z.output<
  ReturnType<typeof reservationOrderObjectSchema>
>;
type CoworkReservationOrderObject = z.output<
  ReturnType<typeof coworkReservationOrderObjectSchema>
>;
type MeetingRoomReservationOrderObject = z.output<
  ReturnType<typeof meetingRoomReservationOrderObjectSchema>
>;
type NormalizedCoworkReservationOrder = Omit<
  CoworkReservationOrderObject,
  "durationMinutes"
> &
  ReservationInterval;
type NormalizedMeetingRoomReservationOrder = Omit<
  MeetingRoomReservationOrderObject,
  "durationMinutes"
> &
  ReservationInterval;
type NormalizedReservationOrder =
  | NormalizedCoworkReservationOrder
  | NormalizedMeetingRoomReservationOrder;
type CoworkReservationFormObject = CoworkReservationOrderObject & {
  readonly date: string;
  readonly legalConsent: boolean;
};
type NormalizedCoworkReservationForm = NormalizedCoworkReservationOrder & {
  readonly date: string;
  readonly legalConsent: boolean;
};

const validateReservationOrder = <T extends ReservationOrderObject>(
  data: T,
  context: z.core.$RefinementCtx<T>
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

  if (data.entryTier === "meeting-room") return;

  const product = getWorkspaceProductByTier(data.entryTier);

  const monitorOption = getReservationProductMonitorOption(data);

  if (product.requiresMonitorOption && !monitorOption) {
    context.addIssue({
      code: "custom",
      path: ["monitorOption"],
      message: m.reservationValidationMonitorRequired(),
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
      message: m.reservationValidationMonitorUnavailable(),
    });
  }

  if (!product.requiresMonitorOption && monitorOption) {
    context.addIssue({
      code: "custom",
      path: ["monitorOption"],
      message: m.reservationValidationMonitorUnavailable(),
    });
  }
};

const normalizeCoworkReservationOrder = (
  data: CoworkReservationOrderObject
): NormalizedCoworkReservationOrder => {
  const product = getWorkspaceProductByTier(data.entryTier);
  const reservation = unsafeNormalizeReservationInterval(data);

  return product.requiresCoffee
    ? { ...reservation, coffee: true }
    : reservation;
};

const normalizeMeetingRoomReservationOrder = (
  data: MeetingRoomReservationOrderObject
): NormalizedMeetingRoomReservationOrder =>
  unsafeNormalizeReservationInterval(data);

const normalizeReservationOrder = (
  data: ReservationOrderObject
): NormalizedReservationOrder =>
  Match.value(data).pipe(
    Match.when(
      { entryTier: "meeting-room" },
      normalizeMeetingRoomReservationOrder
    ),
    Match.orElse(normalizeCoworkReservationOrder)
  );

const normalizeCoworkReservationForm = (
  data: CoworkReservationFormObject
): NormalizedCoworkReservationForm => ({
  ...normalizeCoworkReservationOrder(data),
  date: data.date,
  legalConsent: data.legalConsent,
});

export const getReservationOrderSchema = () =>
  reservationOrderObjectSchema()
    .superRefine(validateReservationOrder)
    .transform(normalizeReservationOrder);

export const getReservationSchema = () =>
  coworkReservationOrderObjectSchema()
    .extend({
      ...reservationFormDateShape,
      legalConsent: z.boolean().refine(Boolean, {
        error: m.reservationValidationLegalConsentRequired(),
      }),
    })
    .superRefine(validateReservationOrder)
    .transform(normalizeCoworkReservationForm);

export type ReservationInput = z.input<ReturnType<typeof getReservationSchema>>;
export type ReservationData = z.output<ReturnType<typeof getReservationSchema>>;
export type ReservationOrderInput = z.input<
  ReturnType<typeof getReservationOrderSchema>
>;
export type ReservationOrderData = z.output<
  ReturnType<typeof getReservationOrderSchema>
>;

type ReservationProductProjectionInput = {
  readonly entryTier: WorkspaceCoworkProductTier | "meeting-room";
  readonly coffee?: boolean;
  readonly monitorOption?: WorkspaceProductMonitorOption;
};

export const getReservationProductCoffee = (
  reservation: ReservationProductProjectionInput
) =>
  Match.value(reservation.entryTier).pipe(
    Match.when("meeting-room", () => false),
    Match.orElse(() => Boolean(reservation.coffee))
  );

export const getReservationProductMonitorOption = (
  reservation: ReservationProductProjectionInput
) =>
  Match.value(reservation.entryTier).pipe(
    Match.when("meeting-room", () => undefined),
    Match.orElse(() => reservation.monitorOption)
  );

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

export const tierIncludesCourtesyCoffee = (tier: WorkspaceCoworkProductTier) =>
  getWorkspaceProductByTier(tier).includesCourtesyCoffee;

export const tierRequiresMonitorOption = (tier: WorkspaceCoworkProductTier) =>
  getWorkspaceProductByTier(tier).requiresMonitorOption;

export const getAllowedMonitorOptionsForTier = (
  tier: WorkspaceCoworkProductTier
) => getWorkspaceProductByTier(tier).allowedMonitorOptions;
