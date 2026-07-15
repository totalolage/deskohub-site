import { type Data, Match, Schema, SchemaGetter } from "effect";
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

export const coworkReservationOrderInputSchema = Schema.TaggedStruct(
  "cowork",
  coworkReservationOrderBaseSchema.fields
);

export const coworkReservationFormInputSchema =
  coworkReservationOrderBaseSchema.mapFields((fields) => ({
    ...fields,
    legalConsent: reservationLegalConsentSchema,
  }));

export type CoworkReservationOrderInput =
  typeof coworkReservationOrderInputSchema.Type;
export type CoworkReservationFormInput =
  typeof coworkReservationFormInputSchema.Type;

export const normalizedBasicCoworkReservationOrderSchema = Schema.Struct({
  ...normalizedReservationCustomerSchema.fields,
  entryTier: Schema.Literal("basic"),
  date: Schema.String,
  coffee: Schema.Boolean,
});

export const normalizedPlusCoworkReservationOrderSchema = Schema.Struct({
  ...normalizedReservationCustomerSchema.fields,
  entryTier: Schema.Literal("plus"),
  date: Schema.String,
  coffee: Schema.Literal(true),
});

export const normalizedProfiCoworkReservationOrderSchema = Schema.Struct({
  ...normalizedReservationCustomerSchema.fields,
  entryTier: Schema.Literal("profi"),
  date: Schema.String,
  coffee: Schema.Literal(true),
  monitorOption: Schema.Literals(workspaceProductMonitorOptions),
});

export const normalizedCoworkReservationOrderSchema = Schema.Union([
  normalizedBasicCoworkReservationOrderSchema,
  normalizedPlusCoworkReservationOrderSchema,
  normalizedProfiCoworkReservationOrderSchema,
]);

export const normalizedCoworkReservationFormSchema = Schema.Union([
  Schema.Struct({
    ...normalizedBasicCoworkReservationOrderSchema.fields,
    legalConsent: Schema.Boolean,
  }),
  Schema.Struct({
    ...normalizedPlusCoworkReservationOrderSchema.fields,
    legalConsent: Schema.Boolean,
  }),
  Schema.Struct({
    ...normalizedProfiCoworkReservationOrderSchema.fields,
    legalConsent: Schema.Boolean,
  }),
]);

export type NormalizedCoworkReservationOrder =
  typeof normalizedCoworkReservationOrderSchema.Type;
export type NormalizedCoworkReservationForm =
  typeof normalizedCoworkReservationFormSchema.Type;

const normalizeMonitorOption = (
  monitorOption: WorkspaceProductMonitorOption | "" | undefined
) => monitorOption || undefined;

export type CoworkReservationProductInput = Data.TaggedEnum<{
  cowork: {
    readonly entryTier: WorkspaceCoworkProductTier;
    readonly coffee?: boolean;
    readonly monitorOption?: WorkspaceProductMonitorOption | "";
  };
}>;

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
  "_tag" | "entryTier" | "date" | "coffee" | "monitorOption"
>;

export const normalizeCoworkReservationOrder = (
  data: CoworkReservationOrderInput | CoworkReservationFormInput
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

const normalizedTaggedBasicCoworkReservationOrderSchema = Schema.TaggedStruct(
  "cowork",
  {
    ...normalizedBasicCoworkReservationOrderSchema.fields,
  }
);
const normalizedTaggedPlusCoworkReservationOrderSchema = Schema.TaggedStruct(
  "cowork",
  {
    ...normalizedPlusCoworkReservationOrderSchema.fields,
  }
);
const normalizedTaggedProfiCoworkReservationOrderSchema = Schema.TaggedStruct(
  "cowork",
  {
    ...normalizedProfiCoworkReservationOrderSchema.fields,
  }
);
const normalizedTaggedCoworkReservationOrderSchema = Schema.Union([
  normalizedTaggedBasicCoworkReservationOrderSchema,
  normalizedTaggedPlusCoworkReservationOrderSchema,
  normalizedTaggedProfiCoworkReservationOrderSchema,
]);

const addCoworkReservationTag = (
  reservation: NormalizedCoworkReservationOrder
) =>
  Match.value(reservation).pipe(
    Match.when({ entryTier: "basic" }, (basicReservation) =>
      normalizedTaggedBasicCoworkReservationOrderSchema.make(basicReservation)
    ),
    Match.when({ entryTier: "plus" }, (plusReservation) =>
      normalizedTaggedPlusCoworkReservationOrderSchema.make(plusReservation)
    ),
    Match.when({ entryTier: "profi" }, (profiReservation) =>
      normalizedTaggedProfiCoworkReservationOrderSchema.make(profiReservation)
    ),
    Match.exhaustive
  );

const decodeCoworkReservationOrder = Schema.decodeUnknownSync(
  coworkReservationOrderInputSchema
);

export const coworkReservationOrderSchema = coworkReservationOrderInputSchema
  .check(Schema.makeFilter(getCoworkReservationIssues))
  .pipe(
    Schema.decodeTo(normalizedTaggedCoworkReservationOrderSchema, {
      decode: SchemaGetter.transform((reservation) =>
        addCoworkReservationTag(normalizeCoworkReservationOrder(reservation))
      ),
      encode: SchemaGetter.transform(decodeCoworkReservationOrder),
    })
  );

export const normalizeCoworkReservationForm = (
  data: CoworkReservationFormInput
): NormalizedCoworkReservationForm => ({
  ...normalizeCoworkReservationOrder(data),
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
