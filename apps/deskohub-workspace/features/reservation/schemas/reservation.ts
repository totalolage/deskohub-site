import "@/shared/polyfills/temporal";

import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Effect, Match, Schema } from "effect";
import { isValidPhoneNumber } from "libphonenumber-js";
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
  type ReservationProductRuleInput,
} from "@/features/reservation/schemas/reservation-product-rules";
import type {
  StoredCoworkReservationDetails,
  StoredMeetingRoomReservationDetails,
  WorkspaceReservationDetailsEntryTierInput,
} from "@/features/reservation/schemas/stored-reservation-details";
import type { SchemaSafeParseResult } from "@/shared/utils/effect-schema-parser";

export const RESERVATION_VALIDATION = {
  name: { min: 2, max: 100 },
  email: { max: 255 },
  phone: { max: 20 },
  message: { max: 1000 },
} as const;

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  Schema.isPattern(emailPattern, { message: m.contactValidationEmailInvalid() })
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
  Schema.isPattern(datePattern, {
    message: m.reservationValidationDateRequired(),
  }),
  Schema.makeFilter(isTodayOrFuturePragueDate, {
    message: m.reservationValidationDatePast(),
  })
);

const legalConsentEffectSchema = Schema.Boolean.check(
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
  startsAt: Schema.optional(Schema.String),
  endsAt: Schema.optional(Schema.String),
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
  legalConsent: legalConsentEffectSchema,
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

type NormalizedReservationOrderBase = Omit<
  CoworkReservationOrderObject,
  "entryTier" | "coffee" | "monitorOption" | keyof ReservationInterval
> &
  ReservationInterval;
type NormalizedCoworkReservationOrder = NormalizedReservationOrderBase &
  WorkspaceReservationDetailsEntryTierInput<StoredCoworkReservationDetails>;
type NormalizedMeetingRoomReservationOrder = Omit<
  MeetingRoomReservationOrderObject,
  "entryTier" | keyof ReservationInterval
> &
  ReservationInterval &
  WorkspaceReservationDetailsEntryTierInput<StoredMeetingRoomReservationDetails>;
type NormalizedReservationOrder =
  | NormalizedCoworkReservationOrder
  | NormalizedMeetingRoomReservationOrder;
type NormalizedCoworkReservationForm = NormalizedCoworkReservationOrder & {
  readonly date: string;
  readonly legalConsent: boolean;
};

type ReservationStandardSchema<Input, Output> = StandardSchemaV1<
  Input,
  Output
> & {
  readonly parse: (input: unknown) => Output;
  readonly safeParse: (input: unknown) => SchemaSafeParseResult<Output>;
};

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
): StandardSchemaV1.Issue => ({
  path,
  message,
});

const getReservationProductRuleInput = (
  data: ReservationValidationObject
): ReservationProductRuleInput =>
  Match.value(data).pipe(
    Match.when({ entryTier: "meeting-room" }, (meetingRoomReservation) => ({
      _tag: "meeting-room" as const,
      startsAt: meetingRoomReservation.startsAt,
      endsAt: meetingRoomReservation.endsAt,
    })),
    Match.when({ entryTier: "basic" }, (coworkReservation) => ({
      _tag: "cowork" as const,
      tier: "basic" as const,
      coffee: coworkReservation.coffee,
      monitorOption: normalizeMonitorOption(coworkReservation.monitorOption),
      ...(getReservationDraftDate(coworkReservation) && {
        date: getReservationDraftDate(coworkReservation),
      }),
      startsAt: coworkReservation.startsAt,
      endsAt: coworkReservation.endsAt,
    })),
    Match.when({ entryTier: "plus" }, (coworkReservation) => ({
      _tag: "cowork" as const,
      tier: "plus" as const,
      coffee: coworkReservation.coffee,
      monitorOption: normalizeMonitorOption(coworkReservation.monitorOption),
      ...(getReservationDraftDate(coworkReservation) && {
        date: getReservationDraftDate(coworkReservation),
      }),
      startsAt: coworkReservation.startsAt,
      endsAt: coworkReservation.endsAt,
    })),
    Match.when({ entryTier: "profi" }, (coworkReservation) => ({
      _tag: "cowork" as const,
      tier: "profi" as const,
      coffee: coworkReservation.coffee,
      monitorOption: normalizeMonitorOption(coworkReservation.monitorOption),
      ...(getReservationDraftDate(coworkReservation) && {
        date: getReservationDraftDate(coworkReservation),
      }),
      startsAt: coworkReservation.startsAt,
      endsAt: coworkReservation.endsAt,
    })),
    Match.exhaustive
  );

const validateReservationOrder = (
  data: ReservationValidationObject
): readonly StandardSchemaV1.Issue[] => {
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

const makeReservationStandardSchema = <Input, Draft, Output>(
  schema: Schema.Decoder<Draft>,
  getIssues: (draft: Draft) => readonly StandardSchemaV1.Issue[],
  normalize: (draft: Draft) => Output
): ReservationStandardSchema<Input, Output> => {
  const standardSchema = Schema.toStandardSchemaV1(schema);

  const validate = (
    input: unknown
  ):
    | StandardSchemaV1.Result<Output>
    | Promise<StandardSchemaV1.Result<Output>> => {
    const result = standardSchema["~standard"].validate(input);
    if (result instanceof Promise) {
      return result.then((resolved) => {
        if (resolved.issues) return resolved;

        const issues = getIssues(resolved.value);
        return issues.length > 0
          ? { issues }
          : { value: normalize(resolved.value) };
      });
    }

    if (result.issues) return result;

    const issues = getIssues(result.value);
    return issues.length > 0 ? { issues } : { value: normalize(result.value) };
  };

  const schemaWithValidation = {
    "~standard": {
      ...standardSchema["~standard"],
      validate,
    },
  } as StandardSchemaV1<Input, Output>;

  const parse = (input: unknown): Output => {
    const result = validate(input);
    if (result instanceof Promise) {
      throw new Error("Reservation schema validation must be synchronous.");
    }

    if (result.issues) {
      throw Object.assign(new Error(result.issues[0]?.message), {
        issues: result.issues,
      });
    }

    return result.value;
  };

  return {
    ...schemaWithValidation,
    parse,
    safeParse: (input: unknown): SchemaSafeParseResult<Output> => {
      try {
        return { success: true, data: parse(input) };
      } catch (error) {
        return { success: false, error };
      }
    },
  };
};

const reservationOrderSchema = makeReservationStandardSchema<
  ReservationOrderObject,
  ReservationOrderObject,
  NormalizedReservationOrder
>(
  reservationOrderObjectEffectSchema,
  validateReservationOrder,
  normalizeReservationOrder
);

const reservationSchema = makeReservationStandardSchema<
  CoworkReservationFormObject,
  CoworkReservationFormObject,
  NormalizedCoworkReservationForm
>(
  coworkReservationFormObjectEffectSchema,
  validateReservationOrder,
  normalizeCoworkReservationForm
);

export const getReservationOrderSchema = () => reservationOrderSchema;

export const getReservationSchema = () => reservationSchema;

export type ReservationInput = StandardSchemaV1.InferInput<
  typeof reservationSchema
>;
export type ReservationData = StandardSchemaV1.InferOutput<
  typeof reservationSchema
>;
export type ReservationOrderInput = StandardSchemaV1.InferInput<
  typeof reservationOrderSchema
>;
export type ReservationOrderData = StandardSchemaV1.InferOutput<
  typeof reservationOrderSchema
>;

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
