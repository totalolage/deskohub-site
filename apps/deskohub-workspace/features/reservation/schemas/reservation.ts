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
  getReservationIntervalValidationIssue,
  getReservationPragueDateRange,
  type ReservationInterval,
  unsafeNormalizeReservationInterval,
} from "@/features/reservation/schemas/reservation-interval";
import {
  getReservationProductRuleIssue,
  ReservationProductRuleInput,
} from "@/features/reservation/schemas/reservation-product-rules";
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

const reservationOrderBaseEffectShape = {
  startsAt: Schema.String,
  endsAt: Schema.String,
  name: reservationCustomerNameEffectSchema,
  email: reservationCustomerEmailEffectSchema,
  phone: reservationCustomerPhoneEffectSchema,
  message: Schema.optional(reservationCustomerMessageEffectSchema),
} as const;

const coworkReservationOrderObjectEffectSchema = Schema.Struct({
  ...reservationOrderBaseEffectShape,
  entryTier: Schema.Literals(workspaceCoworkProductTiers),
  coffee: Schema.Boolean,
  monitorOption: monitorOptionEffectSchema,
});

const meetingRoomReservationOrderObjectEffectSchema = Schema.Struct({
  ...reservationOrderBaseEffectShape,
  entryTier: Schema.Literal("meeting-room"),
});

const reservationOrderObjectEffectSchema = Schema.Union([
  coworkReservationOrderObjectEffectSchema,
  meetingRoomReservationOrderObjectEffectSchema,
]);

const coworkReservationFormObjectEffectSchema = Schema.Struct({
  ...reservationOrderBaseEffectShape,
  entryTier: Schema.Literals(workspaceCoworkProductTiers),
  coffee: Schema.Boolean,
  monitorOption: monitorOptionEffectSchema,
  date: dateEffectSchema,
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
  startsAt: Schema.String,
  endsAt: Schema.String,
  name: Schema.String,
  email: Schema.String,
  phone: Schema.String,
  message: Schema.optional(Schema.String),
};

const normalizedBasicReservationOrderEffectSchema = Schema.Struct({
  ...normalizedReservationOrderBaseEffectShape,
  entryTier: Schema.Literal("basic"),
  coffee: Schema.Boolean,
});

const normalizedPlusReservationOrderEffectSchema = Schema.Struct({
  ...normalizedReservationOrderBaseEffectShape,
  entryTier: Schema.Literal("plus"),
  coffee: Schema.Literal(true),
});

const normalizedProfiReservationOrderEffectSchema = Schema.Struct({
  ...normalizedReservationOrderBaseEffectShape,
  entryTier: Schema.Literal("profi"),
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
});

const normalizedReservationOrderEffectSchema = Schema.Union([
  normalizedCoworkReservationOrderEffectSchema,
  normalizedMeetingRoomReservationOrderEffectSchema,
]);

const normalizedCoworkReservationFormEffectSchema = Schema.Union([
  Schema.Struct({
    ...normalizedBasicReservationOrderEffectSchema.fields,
    date: Schema.String,
    legalConsent: Schema.Boolean,
  }),
  Schema.Struct({
    ...normalizedPlusReservationOrderEffectSchema.fields,
    date: Schema.String,
    legalConsent: Schema.Boolean,
  }),
  Schema.Struct({
    ...normalizedProfiReservationOrderEffectSchema.fields,
    date: Schema.String,
    legalConsent: Schema.Boolean,
  }),
]);

type NormalizedReservationOrderBase = Omit<
  CoworkReservationOrderObject,
  "entryTier" | "coffee" | "monitorOption" | keyof ReservationInterval
> &
  ReservationInterval;
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

const getReservationDraftDate = (reservation: ReservationValidationObject) =>
  "date" in reservation && typeof reservation.date === "string"
    ? reservation.date
    : undefined;

const toIssue = (
  path: readonly PropertyKey[],
  message: string
): Schema.FilterIssue => ({
  path,
  issue: message,
});

const getReservationProductRuleInput = (
  data: ReservationValidationObject
): ReservationProductRuleInput =>
  Match.value(data).pipe(
    Match.when({ entryTier: "meeting-room" }, (meetingRoomReservation) =>
      ReservationProductRuleInput["meeting-room"]({
        startsAt: meetingRoomReservation.startsAt,
        endsAt: meetingRoomReservation.endsAt,
      })
    ),
    Match.when({ entryTier: "basic" }, (coworkReservation) =>
      ReservationProductRuleInput.cowork({
        tier: "basic" as const,
        coffee: coworkReservation.coffee,
        monitorOption: normalizeMonitorOption(coworkReservation.monitorOption),
        ...(getReservationDraftDate(coworkReservation) && {
          date: getReservationDraftDate(coworkReservation),
        }),
        startsAt: coworkReservation.startsAt,
        endsAt: coworkReservation.endsAt,
      })
    ),
    Match.when({ entryTier: "plus" }, (coworkReservation) =>
      ReservationProductRuleInput.cowork({
        tier: "plus" as const,
        coffee: coworkReservation.coffee,
        monitorOption: normalizeMonitorOption(coworkReservation.monitorOption),
        ...(getReservationDraftDate(coworkReservation) && {
          date: getReservationDraftDate(coworkReservation),
        }),
        startsAt: coworkReservation.startsAt,
        endsAt: coworkReservation.endsAt,
      })
    ),
    Match.when({ entryTier: "profi" }, (coworkReservation) =>
      ReservationProductRuleInput.cowork({
        tier: "profi" as const,
        coffee: coworkReservation.coffee,
        monitorOption: normalizeMonitorOption(coworkReservation.monitorOption),
        ...(getReservationDraftDate(coworkReservation) && {
          date: getReservationDraftDate(coworkReservation),
        }),
        startsAt: coworkReservation.startsAt,
        endsAt: coworkReservation.endsAt,
      })
    ),
    Match.exhaustive
  );

const getReservationOrderIssues = (
  data: ReservationValidationObject
): readonly Schema.FilterIssue[] => {
  const intervalIssue = getReservationIntervalValidationIssue(data);
  if (intervalIssue) {
    return [toIssue([intervalIssue.path], intervalIssue.message)];
  }

  const productRuleIssue = getReservationProductRuleIssue(
    getReservationProductRuleInput(data)
  );
  if (productRuleIssue) {
    return [
      toIssue(
        [
          productRuleIssue.path === "entryTier"
            ? "tier"
            : productRuleIssue.path,
        ],
        productRuleIssue.message
      ),
    ];
  }

  if (data.entryTier === "meeting-room") {
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
  const reservation = unsafeNormalizeReservationInterval({
    ...data,
    monitorOption: normalizeMonitorOption(data.monitorOption),
  });
  const base = {
    startsAt: reservation.startsAt,
    endsAt: reservation.endsAt,
    name: reservation.name,
    email: reservation.email,
    phone: reservation.phone,
    ...(reservation.message !== undefined && { message: reservation.message }),
  } satisfies NormalizedReservationOrderBase;

  return Match.value(data).pipe(
    Match.when({ entryTier: "basic" }, () => ({
      ...base,
      entryTier: "basic" as const,
      coffee: data.coffee,
    })),
    Match.when({ entryTier: "plus" }, () => ({
      ...base,
      entryTier: "plus" as const,
      coffee: true as const,
    })),
    Match.when({ entryTier: "profi" }, () => {
      const monitorOption = normalizeMonitorOption(data.monitorOption);
      if (!monitorOption) {
        throw new Error(m.reservationValidationMonitorRequired());
      }

      return {
        ...base,
        entryTier: "profi" as const,
        coffee: true as const,
        monitorOption,
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
    Match.when({ entryTier: "basic" }, normalizeCoworkReservationOrder),
    Match.when({ entryTier: "plus" }, normalizeCoworkReservationOrder),
    Match.when({ entryTier: "profi" }, normalizeCoworkReservationOrder),
    Match.exhaustive
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
