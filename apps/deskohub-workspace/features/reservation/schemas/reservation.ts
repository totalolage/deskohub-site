import { Effect, Match, Schema, SchemaGetter } from "effect";
import { isValidPhoneNumber } from "libphonenumber-js";
import isEmail from "validator/lib/isEmail";
import {
  getWorkspaceProductByTier,
  type WorkspaceCoworkProductTier,
  type WorkspaceProductMonitorOption,
  workspaceCoworkProductTiers,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import { m } from "@/features/i18n";
import { reservationTimeZone } from "@/features/reservation/reservation-date";
import {
  getReservationDurationMinutes,
  getReservationIntervalValidationIssue,
  getReservationPragueDateRange,
  meetingRoomReservationDurationMinutesEffectSchema,
  unsafeNormalizeReservationInterval,
  wholeHourReservationInstantEffectSchema,
} from "@/features/reservation/schemas/reservation-interval";
import { isPlainDateString } from "@/shared/utils/temporal";

export const RESERVATION_VALIDATION = {
  name: { min: 2, max: 100 },
  email: { max: 255 },
  phone: { max: 20 },
  message: { max: 1000 },
} as const;

const getCurrentPragueDate = () =>
  Temporal.Now.zonedDateTimeISO(reservationTimeZone).toPlainDate().toString();

export const isTodayOrFuturePragueDate = (date: string) =>
  date >= getCurrentPragueDate();

export const reservationCustomerNameEffectSchema = Schema.Trim.check(
  Schema.isMinLength(RESERVATION_VALIDATION.name.min, {
    message: m.contactValidationNameMinimum({
      min: RESERVATION_VALIDATION.name.min,
    }),
  }),
  Schema.isMaxLength(RESERVATION_VALIDATION.name.max, {
    message: m.contactValidationNameMaximum({
      max: RESERVATION_VALIDATION.name.max,
    }),
  })
);

export const reservationCustomerEmailEffectSchema = Schema.Trim.check(
  Schema.isNonEmpty({ message: m.contactValidationEmailRequired() }),
  Schema.isMaxLength(RESERVATION_VALIDATION.email.max, {
    message: m.contactValidationEmailMaximum({
      max: RESERVATION_VALIDATION.email.max,
    }),
  }),
  Schema.makeFilter((email) => isEmail(email), {
    message: m.contactValidationEmailInvalid(),
  })
);

export const reservationCustomerPhoneEffectSchema = Schema.Trim.check(
  Schema.isNonEmpty({ message: m.contactValidationPhoneRequired() }),
  Schema.isMaxLength(RESERVATION_VALIDATION.phone.max, {
    message: m.contactValidationPhoneMaximum({
      max: RESERVATION_VALIDATION.phone.max,
    }),
  }),
  Schema.makeFilter((phone) => isValidPhoneNumber(phone, "CZ"), {
    message: m.contactValidationPhoneInvalid(),
  })
);

export const reservationCustomerMessageEffectSchema = Schema.Trim.check(
  Schema.isMaxLength(RESERVATION_VALIDATION.message.max, {
    message: m.contactValidationMessageMaximum({
      max: RESERVATION_VALIDATION.message.max,
    }),
  })
);

const dateEffectSchema = Schema.String.check(
  isPlainDateString({
    message: m.reservationValidationDateRequired(),
  }),
  Schema.makeFilter(isTodayOrFuturePragueDate, {
    message: m.reservationValidationDatePast(),
  })
);

export const reservationLegalConsentEffectSchema = Schema.Boolean.check(
  Schema.makeFilter(Boolean, {
    message: m.reservationValidationLegalConsentRequired(),
  })
);

const monitorOptionEffectSchema = Schema.optional(
  Schema.Union([
    Schema.Literals(workspaceProductMonitorOptions),
    Schema.Literal(""),
  ])
);

const reservationCustomerEffectShape = {
  name: reservationCustomerNameEffectSchema,
  email: reservationCustomerEmailEffectSchema,
  phone: reservationCustomerPhoneEffectSchema,
  message: Schema.optional(reservationCustomerMessageEffectSchema),
} as const;

const coworkReservationOrderObjectEffectSchema = Schema.Struct({
  ...reservationCustomerEffectShape,
  entryTier: Schema.Literals(workspaceCoworkProductTiers),
  date: dateEffectSchema,
  coffee: Schema.Boolean,
  monitorOption: monitorOptionEffectSchema,
});

const meetingRoomReservationOrderObjectEffectSchema = Schema.Struct({
  ...reservationCustomerEffectShape,
  entryTier: Schema.Literal("meeting-room"),
  startsAt: Schema.String,
  endsAt: Schema.String,
});

const reservationOrderObjectEffectSchema = Schema.Union([
  coworkReservationOrderObjectEffectSchema,
  meetingRoomReservationOrderObjectEffectSchema,
]);

const coworkReservationFormObjectEffectSchema = Schema.Struct({
  ...coworkReservationOrderObjectEffectSchema.fields,
  legalConsent: reservationLegalConsentEffectSchema,
});

type ReservationOrderObject = typeof reservationOrderObjectEffectSchema.Type;
type CoworkReservationOrderObject =
  typeof coworkReservationOrderObjectEffectSchema.Type;
type MeetingRoomReservationOrderObject =
  typeof meetingRoomReservationOrderObjectEffectSchema.Type;
type CoworkReservationFormObject =
  typeof coworkReservationFormObjectEffectSchema.Type;
type ReservationValidationObject =
  | ReservationOrderObject
  | CoworkReservationFormObject;

const normalizedReservationOrderBaseEffectShape = {
  name: Schema.String,
  email: Schema.String,
  phone: Schema.String,
  message: Schema.optional(Schema.String),
};

const normalizedBasicReservationOrderEffectSchema = Schema.Struct({
  ...normalizedReservationOrderBaseEffectShape,
  entryTier: Schema.Literal("basic"),
  date: Schema.String,
  coffee: Schema.Boolean,
});

const normalizedPlusReservationOrderEffectSchema = Schema.Struct({
  ...normalizedReservationOrderBaseEffectShape,
  entryTier: Schema.Literal("plus"),
  date: Schema.String,
  coffee: Schema.Literal(true),
});

const normalizedProfiReservationOrderEffectSchema = Schema.Struct({
  ...normalizedReservationOrderBaseEffectShape,
  entryTier: Schema.Literal("profi"),
  date: Schema.String,
  coffee: Schema.Literal(true),
  monitorOption: Schema.Literals(workspaceProductMonitorOptions),
});

const normalizedCoworkReservationOrderEffectSchema = Schema.Union([
  normalizedBasicReservationOrderEffectSchema,
  normalizedPlusReservationOrderEffectSchema,
  normalizedProfiReservationOrderEffectSchema,
]);

const normalizedMeetingRoomReservationOrderEffectSchema = Schema.Struct({
  ...normalizedReservationOrderBaseEffectShape,
  entryTier: Schema.Literal("meeting-room"),
  startsAt: Schema.String,
  endsAt: Schema.String,
});

const normalizedReservationOrderEffectSchema = Schema.Union([
  normalizedCoworkReservationOrderEffectSchema,
  normalizedMeetingRoomReservationOrderEffectSchema,
]);

const normalizedCoworkReservationFormEffectSchema = Schema.Union([
  Schema.Struct({
    ...normalizedBasicReservationOrderEffectSchema.fields,
    legalConsent: Schema.Boolean,
  }),
  Schema.Struct({
    ...normalizedPlusReservationOrderEffectSchema.fields,
    legalConsent: Schema.Boolean,
  }),
  Schema.Struct({
    ...normalizedProfiReservationOrderEffectSchema.fields,
    legalConsent: Schema.Boolean,
  }),
]);

type NormalizedReservationOrderBase = Omit<
  CoworkReservationOrderObject,
  "entryTier" | "date" | "coffee" | "monitorOption"
>;
type NormalizedCoworkReservationOrder =
  typeof normalizedCoworkReservationOrderEffectSchema.Type;
type NormalizedMeetingRoomReservationOrder =
  typeof normalizedMeetingRoomReservationOrderEffectSchema.Type;
type NormalizedReservationOrder =
  typeof normalizedReservationOrderEffectSchema.Type;
type NormalizedCoworkReservationForm =
  typeof normalizedCoworkReservationFormEffectSchema.Type;

const normalizeMonitorOption = (
  monitorOption: WorkspaceProductMonitorOption | "" | undefined
) => monitorOption || undefined;

const isMeetingRoomReservationDuration = Schema.is(
  meetingRoomReservationDurationMinutesEffectSchema
);
const isWholeHourReservationInstant = Schema.is(
  wholeHourReservationInstantEffectSchema
);

const toIssue = (
  path: readonly PropertyKey[],
  message: string
): Schema.FilterIssue => ({
  path,
  issue: message,
});

const getReservationOrderIssues = (
  data: ReservationValidationObject
): readonly Schema.FilterIssue[] => {
  const intervalIssue = getReservationIntervalValidationIssue(data);
  if (intervalIssue) {
    return [toIssue([intervalIssue.path], intervalIssue.message)];
  }

  if (data.entryTier === "meeting-room") {
    const interval = unsafeNormalizeReservationInterval(data);
    if (!isWholeHourReservationInstant(interval.startsAt)) {
      return [
        toIssue(
          ["startsAt"],
          "Meeting room reservations must start on a whole hour."
        ),
      ];
    }

    if (
      !isMeetingRoomReservationDuration(getReservationDurationMinutes(interval))
    ) {
      return [
        toIssue(
          ["endsAt"],
          "Meeting room duration must be 1 hour, 4 hours, or 24 hours."
        ),
      ];
    }

    const range = Effect.runSync(getReservationPragueDateRange(data));
    if (range.startMs < Date.now()) {
      return [toIssue(["startsAt"], m.reservationValidationDatePast())];
    }

    return [];
  }

  const product = getWorkspaceProductByTier(data.entryTier);
  const monitorOption = getReservationProductMonitorOption(data);

  if (product.requiresMonitorOption && !monitorOption) {
    return [
      toIssue(["monitorOption"], m.reservationValidationMonitorRequired()),
    ];
  }

  if (
    product.requiresMonitorOption &&
    monitorOption &&
    !product.allowedMonitorOptions.includes(monitorOption)
  ) {
    return [
      toIssue(["monitorOption"], m.reservationValidationMonitorUnavailable()),
    ];
  }

  if (!product.requiresMonitorOption && monitorOption) {
    return [
      toIssue(["monitorOption"], m.reservationValidationMonitorUnavailable()),
    ];
  }

  return [];
};

const normalizeCoworkReservationOrder = (
  data: CoworkReservationOrderObject
): NormalizedCoworkReservationOrder => {
  const base: NormalizedReservationOrderBase = {
    name: data.name,
    email: data.email,
    phone: data.phone,
    ...(data.message !== undefined && { message: data.message }),
  };

  return Match.value(data).pipe(
    Match.when({ entryTier: "basic" }, () => ({
      ...base,
      entryTier: "basic" as const,
      date: data.date,
      coffee: data.coffee,
    })),
    Match.when({ entryTier: "plus" }, () => ({
      ...base,
      entryTier: "plus" as const,
      date: data.date,
      coffee: true as const,
    })),
    Match.when({ entryTier: "profi" }, () => {
      return {
        ...base,
        entryTier: "profi" as const,
        date: data.date,
        coffee: true as const,
        monitorOption: normalizeMonitorOption(data.monitorOption)!,
      };
    }),
    Match.exhaustive
  );
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

const reservationOrderDraftEffectSchema =
  reservationOrderObjectEffectSchema.check(
    Schema.makeFilter(getReservationOrderIssues)
  );

const reservationFormDraftEffectSchema =
  coworkReservationFormObjectEffectSchema.check(
    Schema.makeFilter(getReservationOrderIssues)
  );

export const reservationOrderEffectSchema =
  reservationOrderDraftEffectSchema.pipe(
    Schema.decodeTo(normalizedReservationOrderEffectSchema, {
      decode: SchemaGetter.transform(normalizeReservationOrder),
      encode: SchemaGetter.transform(
        (reservation): ReservationOrderObject => reservation
      ),
    })
  );

export const reservationEffectSchema = reservationFormDraftEffectSchema.pipe(
  Schema.decodeTo(normalizedCoworkReservationFormEffectSchema, {
    decode: SchemaGetter.transform(normalizeCoworkReservationForm),
    encode: SchemaGetter.transform(
      (reservation): CoworkReservationFormObject => reservation
    ),
  })
);

export type ReservationInput = typeof reservationEffectSchema.Encoded;
export type ReservationData = typeof reservationEffectSchema.Type;
export type ReservationOrderInput = typeof reservationOrderEffectSchema.Encoded;
export type ReservationOrderData = typeof reservationOrderEffectSchema.Type;

type ReservationProductProjectionInput =
  | {
      readonly entryTier: WorkspaceCoworkProductTier;
      readonly coffee?: boolean;
      readonly monitorOption?: WorkspaceProductMonitorOption | "";
    }
  | {
      readonly entryTier: "meeting-room";
      readonly coffee?: boolean;
      readonly monitorOption?: WorkspaceProductMonitorOption | "";
    };

export const getReservationProductCoffee = (
  reservation: ReservationProductProjectionInput
) =>
  Match.value(reservation.entryTier).pipe(
    Match.when("meeting-room", () => false),
    Match.when("basic", () => Boolean(reservation.coffee)),
    Match.when("plus", () => Boolean(reservation.coffee)),
    Match.when("profi", () => Boolean(reservation.coffee)),
    Match.exhaustive
  );

export const getReservationProductMonitorOption = (
  reservation: ReservationProductProjectionInput
) =>
  Match.value(reservation.entryTier).pipe(
    Match.when("meeting-room", () => undefined),
    Match.when("basic", () =>
      normalizeMonitorOption(reservation.monitorOption)
    ),
    Match.when("plus", () => normalizeMonitorOption(reservation.monitorOption)),
    Match.when("profi", () =>
      normalizeMonitorOption(reservation.monitorOption)
    ),
    Match.exhaustive
  );

export const reservationDefaultValues: ReservationInput = {
  entryTier: "basic",
  date: "",
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
