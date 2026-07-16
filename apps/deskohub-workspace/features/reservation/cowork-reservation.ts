import { Match, Schema, SchemaGetter } from "effect";
import {
  getWorkspaceProductByTier,
  type WorkspaceCoworkProductTier,
  type WorkspaceProductMonitorOption,
  workspaceCoworkProductTiers,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import { m } from "@/features/i18n";
import { reservationLegalConsentSchema } from "@/features/reservation/reservation-consent";
import {
  normalizedReservationCustomerSchema,
  reservationCustomerSchema,
} from "@/features/reservation/reservation-contact";
import { isTodayOrFuturePragueDate } from "@/features/reservation/reservation-date";
import type { ReservationIntervalInput } from "@/features/reservation/reservation-interval-domain";
import { coworkReservationKind } from "@/features/reservation/reservation-kind";
import {
  isPlainDateString,
  localDateTimeSchema,
} from "@/shared/utils/temporal";

const decodeLocalDateTime = Schema.decodeUnknownSync(localDateTimeSchema);

export const getCoworkReservationIntervalInput = (
  date: string
): ReservationIntervalInput => ({
  startsAt: decodeLocalDateTime(`${date}T00:00`),
  endsAt: decodeLocalDateTime(
    `${Temporal.PlainDate.from(date).add({ days: 1 })}T00:00`
  ),
});

const dateSchema = Schema.String.check(
  isPlainDateString({
    message: m.reservationValidationDateRequired(),
  }),
  Schema.makeFilter(isTodayOrFuturePragueDate, {
    message: m.reservationValidationDatePast(),
  })
);

const monitorOptionSchema = Schema.optional(
  Schema.Union([
    Schema.Literals(workspaceProductMonitorOptions),
    Schema.Literal(""),
  ])
);

const coworkReservationOrderBaseSchema = Schema.Struct({
  ...reservationCustomerSchema.fields,
  entryTier: Schema.Literals(workspaceCoworkProductTiers),
  date: dateSchema,
  coffee: Schema.Boolean,
  monitorOption: monitorOptionSchema,
});

export const coworkReservationOrderInputSchema = Schema.Struct({
  kind: Schema.Literal(coworkReservationKind),
  ...coworkReservationOrderBaseSchema.fields,
});

export const coworkReservationFormInputSchema =
  coworkReservationOrderBaseSchema.mapFields((fields) => ({
    ...fields,
    legalConsent: reservationLegalConsentSchema,
  }));

export type CoworkReservationOrderInput =
  typeof coworkReservationOrderInputSchema.Type;
export type CoworkReservationFormInput =
  typeof coworkReservationFormInputSchema.Type;

const normalizedBasicCoworkReservationDetailsSchema = Schema.Struct({
  ...normalizedReservationCustomerSchema.fields,
  entryTier: Schema.Literal("basic"),
  date: Schema.String,
  coffee: Schema.Boolean,
});

const normalizedPlusCoworkReservationDetailsSchema = Schema.Struct({
  ...normalizedReservationCustomerSchema.fields,
  entryTier: Schema.Literal("plus"),
  date: Schema.String,
  coffee: Schema.Literal(true),
});

const normalizedProfiCoworkReservationDetailsSchema = Schema.Struct({
  ...normalizedReservationCustomerSchema.fields,
  entryTier: Schema.Literal("profi"),
  date: Schema.String,
  coffee: Schema.Literal(true),
  monitorOption: Schema.Literals(workspaceProductMonitorOptions),
});

const normalizedCoworkReservationDetailsSchema = Schema.Union([
  normalizedBasicCoworkReservationDetailsSchema,
  normalizedPlusCoworkReservationDetailsSchema,
  normalizedProfiCoworkReservationDetailsSchema,
]);

export const normalizedCoworkReservationFormSchema = Schema.Union([
  Schema.Struct({
    ...normalizedBasicCoworkReservationDetailsSchema.fields,
    legalConsent: Schema.Boolean,
  }),
  Schema.Struct({
    ...normalizedPlusCoworkReservationDetailsSchema.fields,
    legalConsent: Schema.Boolean,
  }),
  Schema.Struct({
    ...normalizedProfiCoworkReservationDetailsSchema.fields,
    legalConsent: Schema.Boolean,
  }),
]);

type NormalizedCoworkReservationDetails =
  typeof normalizedCoworkReservationDetailsSchema.Type;
export type NormalizedCoworkReservationForm =
  typeof normalizedCoworkReservationFormSchema.Type;

const normalizeMonitorOption = (
  monitorOption: WorkspaceProductMonitorOption | "" | undefined
) => monitorOption || undefined;

export type CoworkReservationProductInput = Pick<
  CoworkReservationOrderInput,
  "kind" | "entryTier" | "coffee" | "monitorOption"
>;

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
  data: CoworkReservationOrderInput | CoworkReservationFormInput
): readonly Schema.FilterIssue[] => {
  const product = getWorkspaceProductByTier(data.entryTier);
  const monitorOption = normalizeMonitorOption(data.monitorOption);

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
  CoworkReservationOrderInput,
  "kind" | "entryTier" | "date" | "coffee" | "monitorOption"
>;

const normalizeCoworkReservationDetails = (
  data: CoworkReservationOrderInput | CoworkReservationFormInput
): NormalizedCoworkReservationDetails => {
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

export const normalizedBasicCoworkReservationOrderSchema = Schema.Struct({
  kind: Schema.Literal(coworkReservationKind),
  ...normalizedBasicCoworkReservationDetailsSchema.fields,
});
export const normalizedPlusCoworkReservationOrderSchema = Schema.Struct({
  kind: Schema.Literal(coworkReservationKind),
  ...normalizedPlusCoworkReservationDetailsSchema.fields,
});
export const normalizedProfiCoworkReservationOrderSchema = Schema.Struct({
  kind: Schema.Literal(coworkReservationKind),
  ...normalizedProfiCoworkReservationDetailsSchema.fields,
});
export const normalizedCoworkReservationOrderSchema = Schema.Union([
  normalizedBasicCoworkReservationOrderSchema,
  normalizedPlusCoworkReservationOrderSchema,
  normalizedProfiCoworkReservationOrderSchema,
]);

export type NormalizedCoworkReservationOrder =
  typeof normalizedCoworkReservationOrderSchema.Type;

const toCoworkReservationOrder = (
  reservation: NormalizedCoworkReservationDetails
) =>
  Match.value(reservation).pipe(
    Match.discriminatorsExhaustive("entryTier")({
      basic: (basicReservation) =>
        normalizedBasicCoworkReservationOrderSchema.make({
          ...basicReservation,
          kind: coworkReservationKind,
        }),
      plus: (plusReservation) =>
        normalizedPlusCoworkReservationOrderSchema.make({
          ...plusReservation,
          kind: coworkReservationKind,
        }),
      profi: (profiReservation) =>
        normalizedProfiCoworkReservationOrderSchema.make({
          ...profiReservation,
          kind: coworkReservationKind,
        }),
    })
  );

const decodeCoworkReservationOrder = Schema.decodeUnknownSync(
  coworkReservationOrderInputSchema
);

export const coworkReservationOrderSchema = coworkReservationOrderInputSchema
  .check(Schema.makeFilter(getCoworkReservationIssues))
  .pipe(
    Schema.decodeTo(normalizedCoworkReservationOrderSchema, {
      decode: SchemaGetter.transform((reservation) =>
        toCoworkReservationOrder(normalizeCoworkReservationDetails(reservation))
      ),
      encode: SchemaGetter.transform(decodeCoworkReservationOrder),
    })
  );

export const normalizeCoworkReservationForm = (
  data: CoworkReservationFormInput
): NormalizedCoworkReservationForm => ({
  ...normalizeCoworkReservationDetails(data),
  legalConsent: data.legalConsent,
});

const coworkReservationDraftSchema = coworkReservationFormInputSchema.check(
  Schema.makeFilter(getCoworkReservationIssues)
);

export const coworkReservationSchema = coworkReservationDraftSchema.pipe(
  Schema.decodeTo(normalizedCoworkReservationFormSchema, {
    decode: SchemaGetter.transform(normalizeCoworkReservationForm),
    encode: SchemaGetter.transform(
      (reservation): CoworkReservationFormInput => reservation
    ),
  })
);

export type CoworkReservationInput = typeof coworkReservationSchema.Encoded;
export type CoworkReservationData = typeof coworkReservationSchema.Type;

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
