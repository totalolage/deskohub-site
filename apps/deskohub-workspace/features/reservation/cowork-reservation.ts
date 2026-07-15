import { Match, Schema, SchemaGetter } from "effect";
import {
  getWorkspaceProductByTier,
  type WorkspaceCoworkProductTier,
  type WorkspaceProductMonitorOption,
  workspaceCoworkProductTiers,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import { m } from "@/features/i18n";
import { reservationLegalConsentEffectSchema } from "@/features/reservation/reservation-consent";
import { reservationCustomerEffectFields } from "@/features/reservation/reservation-contact";
import { isTodayOrFuturePragueDate } from "@/features/reservation/reservation-date";
import type { ReservationIntervalInput } from "@/features/reservation/reservation-interval-domain";
import {
  isPlainDateString,
  localDateTimeEffectSchema,
} from "@/shared/utils/temporal";

const decodeLocalDateTime = Schema.decodeUnknownSync(localDateTimeEffectSchema);

export const getCoworkReservationIntervalInput = (
  date: string
): ReservationIntervalInput => ({
  startsAt: decodeLocalDateTime(`${date}T00:00`),
  endsAt: decodeLocalDateTime(
    `${Temporal.PlainDate.from(date).add({ days: 1 })}T00:00`
  ),
});

const dateEffectSchema = Schema.String.check(
  isPlainDateString({
    message: m.reservationValidationDateRequired(),
  }),
  Schema.makeFilter(isTodayOrFuturePragueDate, {
    message: m.reservationValidationDatePast(),
  })
);

const monitorOptionEffectSchema = Schema.optional(
  Schema.Union([
    Schema.Literals(workspaceProductMonitorOptions),
    Schema.Literal(""),
  ])
);

export const coworkReservationOrderObjectEffectSchema = Schema.Struct({
  ...reservationCustomerEffectFields,
  entryTier: Schema.Literals(workspaceCoworkProductTiers),
  date: dateEffectSchema,
  coffee: Schema.Boolean,
  monitorOption: monitorOptionEffectSchema,
});

export const coworkReservationFormObjectEffectSchema = Schema.Struct({
  ...coworkReservationOrderObjectEffectSchema.fields,
  legalConsent: reservationLegalConsentEffectSchema,
});

export type CoworkReservationOrderObject =
  typeof coworkReservationOrderObjectEffectSchema.Type;
export type CoworkReservationFormObject =
  typeof coworkReservationFormObjectEffectSchema.Type;

const normalizedReservationBaseEffectFields = {
  name: Schema.String,
  email: Schema.String,
  phone: Schema.String,
  message: Schema.optional(Schema.String),
};

export const normalizedBasicCoworkReservationOrderEffectSchema = Schema.Struct({
  ...normalizedReservationBaseEffectFields,
  entryTier: Schema.Literal("basic"),
  date: Schema.String,
  coffee: Schema.Boolean,
});

export const normalizedPlusCoworkReservationOrderEffectSchema = Schema.Struct({
  ...normalizedReservationBaseEffectFields,
  entryTier: Schema.Literal("plus"),
  date: Schema.String,
  coffee: Schema.Literal(true),
});

export const normalizedProfiCoworkReservationOrderEffectSchema = Schema.Struct({
  ...normalizedReservationBaseEffectFields,
  entryTier: Schema.Literal("profi"),
  date: Schema.String,
  coffee: Schema.Literal(true),
  monitorOption: Schema.Literals(workspaceProductMonitorOptions),
});

export const normalizedCoworkReservationOrderEffectSchema = Schema.Union([
  normalizedBasicCoworkReservationOrderEffectSchema,
  normalizedPlusCoworkReservationOrderEffectSchema,
  normalizedProfiCoworkReservationOrderEffectSchema,
]);

export const normalizedCoworkReservationFormEffectSchema = Schema.Union([
  Schema.Struct({
    ...normalizedBasicCoworkReservationOrderEffectSchema.fields,
    legalConsent: Schema.Boolean,
  }),
  Schema.Struct({
    ...normalizedPlusCoworkReservationOrderEffectSchema.fields,
    legalConsent: Schema.Boolean,
  }),
  Schema.Struct({
    ...normalizedProfiCoworkReservationOrderEffectSchema.fields,
    legalConsent: Schema.Boolean,
  }),
]);

export type NormalizedCoworkReservationOrder =
  typeof normalizedCoworkReservationOrderEffectSchema.Type;
export type NormalizedCoworkReservationForm =
  typeof normalizedCoworkReservationFormEffectSchema.Type;

const normalizeMonitorOption = (
  monitorOption: WorkspaceProductMonitorOption | "" | undefined
) => monitorOption || undefined;

export type CoworkReservationProductInput = {
  readonly entryTier: WorkspaceCoworkProductTier;
  readonly coffee?: boolean;
  readonly monitorOption?: WorkspaceProductMonitorOption | "";
};

export const getCoworkReservationProductCoffee = (
  reservation: CoworkReservationProductInput
) => Boolean(reservation.coffee);

export const getCoworkReservationProductMonitorOption = (
  reservation: CoworkReservationProductInput
) => normalizeMonitorOption(reservation.monitorOption);

export const getCoworkTierIncludesCourtesyCoffee = (
  tier: WorkspaceCoworkProductTier
) => getWorkspaceProductByTier(tier).includesCourtesyCoffee;

export const getCoworkTierRequiresMonitorOption = (
  tier: WorkspaceCoworkProductTier
) => getWorkspaceProductByTier(tier).requiresMonitorOption;

export const getAllowedMonitorOptionsForCoworkTier = (
  tier: WorkspaceCoworkProductTier
) => getWorkspaceProductByTier(tier).allowedMonitorOptions;

export const getCoworkReservationIssues = (
  data: CoworkReservationOrderObject | CoworkReservationFormObject
): readonly Schema.FilterIssue[] => {
  const product = getWorkspaceProductByTier(data.entryTier);
  const monitorOption = getCoworkReservationProductMonitorOption(data);

  if (product.requiresMonitorOption && !monitorOption) {
    return [
      {
        path: ["monitorOption"],
        issue: m.reservationValidationMonitorRequired(),
      },
    ];
  }

  if (
    product.requiresMonitorOption &&
    monitorOption &&
    !product.allowedMonitorOptions.includes(monitorOption)
  ) {
    return [
      {
        path: ["monitorOption"],
        issue: m.reservationValidationMonitorUnavailable(),
      },
    ];
  }

  if (!product.requiresMonitorOption && monitorOption) {
    return [
      {
        path: ["monitorOption"],
        issue: m.reservationValidationMonitorUnavailable(),
      },
    ];
  }

  return [];
};

type NormalizedCoworkReservationBase = Omit<
  CoworkReservationOrderObject,
  "entryTier" | "date" | "coffee" | "monitorOption"
>;

export const normalizeCoworkReservationOrder = (
  data: CoworkReservationOrderObject
): NormalizedCoworkReservationOrder => {
  const base: NormalizedCoworkReservationBase = {
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
    Match.when({ entryTier: "profi" }, () => ({
      ...base,
      entryTier: "profi" as const,
      date: data.date,
      coffee: true as const,
      monitorOption: normalizeMonitorOption(data.monitorOption)!,
    })),
    Match.exhaustive
  );
};

export const normalizeCoworkReservationForm = (
  data: CoworkReservationFormObject
): NormalizedCoworkReservationForm => ({
  ...normalizeCoworkReservationOrder(data),
  legalConsent: data.legalConsent,
});

const coworkReservationDraftEffectSchema =
  coworkReservationFormObjectEffectSchema.check(
    Schema.makeFilter(getCoworkReservationIssues)
  );

export const coworkReservationEffectSchema =
  coworkReservationDraftEffectSchema.pipe(
    Schema.decodeTo(normalizedCoworkReservationFormEffectSchema, {
      decode: SchemaGetter.transform(normalizeCoworkReservationForm),
      encode: SchemaGetter.transform(
        (reservation): CoworkReservationFormObject => reservation
      ),
    })
  );

export type CoworkReservationInput =
  typeof coworkReservationEffectSchema.Encoded;
export type CoworkReservationData = typeof coworkReservationEffectSchema.Type;

export const coworkReservationDefaultValues: CoworkReservationInput = {
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

export type { WorkspaceCoworkProductTier };
