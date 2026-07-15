import { type Data, Match, Schema, SchemaGetter } from "effect";
import {
  getWorkspaceProductByTier,
  type WorkspaceCoworkProductTier,
  type WorkspaceProductMonitorOption,
  workspaceCoworkProductTiers,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import { m } from "@/features/i18n";
import { reservationLegalConsentEffectSchema } from "@/features/reservation/reservation-consent";
import {
  normalizedReservationCustomerEffectSchema,
  reservationCustomerEffectSchema,
} from "@/features/reservation/reservation-contact";
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

const coworkReservationOrderBaseEffectSchema = Schema.Struct({
  ...reservationCustomerEffectSchema.fields,
  entryTier: Schema.Literals(workspaceCoworkProductTiers),
  date: dateEffectSchema,
  coffee: Schema.Boolean,
  monitorOption: monitorOptionEffectSchema,
});

export const coworkReservationOrderObjectEffectSchema = Schema.TaggedStruct(
  "cowork",
  coworkReservationOrderBaseEffectSchema.fields
);

export const coworkReservationFormObjectEffectSchema =
  coworkReservationOrderBaseEffectSchema.mapFields((fields) => ({
    ...fields,
    legalConsent: reservationLegalConsentEffectSchema,
  }));

export type CoworkReservationOrderObject =
  typeof coworkReservationOrderObjectEffectSchema.Type;
export type CoworkReservationFormObject =
  typeof coworkReservationFormObjectEffectSchema.Type;

export const normalizedBasicCoworkReservationOrderEffectSchema = Schema.Struct({
  ...normalizedReservationCustomerEffectSchema.fields,
  entryTier: Schema.Literal("basic"),
  date: Schema.String,
  coffee: Schema.Boolean,
});

export const normalizedPlusCoworkReservationOrderEffectSchema = Schema.Struct({
  ...normalizedReservationCustomerEffectSchema.fields,
  entryTier: Schema.Literal("plus"),
  date: Schema.String,
  coffee: Schema.Literal(true),
});

export const normalizedProfiCoworkReservationOrderEffectSchema = Schema.Struct({
  ...normalizedReservationCustomerEffectSchema.fields,
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
  data: CoworkReservationOrderObject | CoworkReservationFormObject
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
  CoworkReservationOrderObject,
  "_tag" | "entryTier" | "date" | "coffee" | "monitorOption"
>;

export const normalizeCoworkReservationOrder = (
  data: CoworkReservationOrderObject | CoworkReservationFormObject
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

const normalizedTaggedBasicCoworkReservationOrderEffectSchema =
  Schema.TaggedStruct("cowork", {
    ...normalizedBasicCoworkReservationOrderEffectSchema.fields,
  });
const normalizedTaggedPlusCoworkReservationOrderEffectSchema =
  Schema.TaggedStruct("cowork", {
    ...normalizedPlusCoworkReservationOrderEffectSchema.fields,
  });
const normalizedTaggedProfiCoworkReservationOrderEffectSchema =
  Schema.TaggedStruct("cowork", {
    ...normalizedProfiCoworkReservationOrderEffectSchema.fields,
  });
const normalizedTaggedCoworkReservationOrderEffectSchema = Schema.Union([
  normalizedTaggedBasicCoworkReservationOrderEffectSchema,
  normalizedTaggedPlusCoworkReservationOrderEffectSchema,
  normalizedTaggedProfiCoworkReservationOrderEffectSchema,
]);

const addCoworkReservationTag = (
  reservation: NormalizedCoworkReservationOrder
) =>
  Match.value(reservation).pipe(
    Match.when({ entryTier: "basic" }, (basicReservation) =>
      normalizedTaggedBasicCoworkReservationOrderEffectSchema.make(
        basicReservation
      )
    ),
    Match.when({ entryTier: "plus" }, (plusReservation) =>
      normalizedTaggedPlusCoworkReservationOrderEffectSchema.make(
        plusReservation
      )
    ),
    Match.when({ entryTier: "profi" }, (profiReservation) =>
      normalizedTaggedProfiCoworkReservationOrderEffectSchema.make(
        profiReservation
      )
    ),
    Match.exhaustive
  );

const decodeCoworkReservationOrder = Schema.decodeUnknownSync(
  coworkReservationOrderObjectEffectSchema
);

export const coworkReservationOrderEffectSchema =
  coworkReservationOrderObjectEffectSchema
    .check(Schema.makeFilter(getCoworkReservationIssues))
    .pipe(
      Schema.decodeTo(normalizedTaggedCoworkReservationOrderEffectSchema, {
        decode: SchemaGetter.transform((reservation) =>
          addCoworkReservationTag(normalizeCoworkReservationOrder(reservation))
        ),
        encode: SchemaGetter.transform(decodeCoworkReservationOrder),
      })
    );

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
