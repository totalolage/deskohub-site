import { Match, Schema, SchemaGetter } from "effect";
import { m } from "@/features/i18n";
import {
  coworkReservationProductInputSchema,
  getAllowedMonitorOptionsForCoworkTier,
  getCoworkReservationProductCoffee,
  getCoworkReservationProductIssues,
  getCoworkReservationProductMonitorOption,
  getCoworkTierIncludesCourtesyCoffee,
  getCoworkTierRequiresMonitorOption,
  normalizeCoworkReservationProduct,
  normalizedBasicCoworkReservationProductSchema,
  normalizedPlusCoworkReservationProductSchema,
  normalizedProfiCoworkReservationProductSchema,
  type WorkspaceCoworkProductTier,
} from "@/features/reservation/cowork-reservation-product";
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
  plainDateStringSchema,
} from "@/shared/utils/temporal";

export const workspaceCoworkProductIdentitySchema = Schema.Struct({
  kind: Schema.Literal(coworkReservationKind),
  tier: coworkReservationProductInputSchema.fields.entryTier,
});

export type WorkspaceCoworkProductIdentity =
  typeof workspaceCoworkProductIdentitySchema.Type;

export const workspaceCoworkProductKeySchema = Schema.TemplateLiteral([
  workspaceCoworkProductIdentitySchema.fields.kind,
  ":",
  workspaceCoworkProductIdentitySchema.fields.tier,
]);

export type WorkspaceCoworkProductKey =
  typeof workspaceCoworkProductKeySchema.Type;

export const getWorkspaceCoworkProductKey = ({
  kind,
  tier,
}: WorkspaceCoworkProductIdentity): WorkspaceCoworkProductKey =>
  `${kind}:${tier}`;

const decodeLocalDateTime = Schema.decodeUnknownSync(localDateTimeSchema);
const decodePlainDate = Schema.decodeUnknownSync(plainDateStringSchema);

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

const coworkReservationOrderBaseSchema = Schema.Struct({
  ...reservationCustomerSchema.fields,
  ...coworkReservationProductInputSchema.fields,
  date: dateSchema,
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

export const normalizedBasicCoworkReservationOrderSchema = Schema.Struct({
  kind: Schema.Literal(coworkReservationKind),
  ...normalizedReservationCustomerSchema.fields,
  ...normalizedBasicCoworkReservationProductSchema.fields,
  date: plainDateStringSchema,
});

export const normalizedPlusCoworkReservationOrderSchema = Schema.Struct({
  kind: Schema.Literal(coworkReservationKind),
  ...normalizedReservationCustomerSchema.fields,
  ...normalizedPlusCoworkReservationProductSchema.fields,
  date: plainDateStringSchema,
});

export const normalizedProfiCoworkReservationOrderSchema = Schema.Struct({
  kind: Schema.Literal(coworkReservationKind),
  ...normalizedReservationCustomerSchema.fields,
  ...normalizedProfiCoworkReservationProductSchema.fields,
  date: plainDateStringSchema,
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

const coworkReservationDetailsDateSchema = Schema.toEncoded(
  plainDateStringSchema
);

const basicCoworkReservationDetailsSchema = Schema.Struct({
  ...normalizedBasicCoworkReservationProductSchema.fields,
  date: coworkReservationDetailsDateSchema,
});

const plusCoworkReservationDetailsSchema = Schema.Struct({
  ...normalizedPlusCoworkReservationProductSchema.fields,
  date: coworkReservationDetailsDateSchema,
});

const profiCoworkReservationDetailsSchema = Schema.Struct({
  ...normalizedProfiCoworkReservationProductSchema.fields,
  date: coworkReservationDetailsDateSchema,
});

export const coworkReservationDetailsSchema = Schema.Union([
  basicCoworkReservationDetailsSchema,
  plusCoworkReservationDetailsSchema,
  profiCoworkReservationDetailsSchema,
]).annotate({
  identifier: "CoworkReservationDetails",
  description: "PII-free cowork reservation projection for external consumers.",
});

export type CoworkReservationDetails =
  typeof coworkReservationDetailsSchema.Type;

export const getCoworkReservationDetails = (
  reservation: NormalizedCoworkReservationOrder
): CoworkReservationDetails =>
  Match.value(reservation).pipe(
    Match.discriminatorsExhaustive("entryTier")({
      basic: (basicReservation) =>
        basicCoworkReservationDetailsSchema.make({
          entryTier: basicReservation.entryTier,
          date: basicReservation.date,
          coffee: basicReservation.coffee,
        }),
      plus: (plusReservation) =>
        plusCoworkReservationDetailsSchema.make({
          entryTier: plusReservation.entryTier,
          date: plusReservation.date,
          coffee: true,
        }),
      profi: (profiReservation) =>
        profiCoworkReservationDetailsSchema.make({
          entryTier: profiReservation.entryTier,
          date: profiReservation.date,
          coffee: true,
          monitorOption: profiReservation.monitorOption,
        }),
    })
  );

export const getCoworkReservationIssues = (
  data: CoworkReservationOrderInput | CoworkReservationFormInput
): readonly Schema.FilterIssue[] => getCoworkReservationProductIssues(data);

type NormalizedCoworkReservationBase = Omit<
  CoworkReservationOrderInput,
  "kind" | "entryTier" | "date" | "coffee" | "monitorOption"
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
  const product = normalizeCoworkReservationProduct(data);
  const date = decodePlainDate(data.date);

  return Match.value(product).pipe(
    Match.discriminatorsExhaustive("entryTier")({
      basic: (basicProduct) =>
        normalizedBasicCoworkReservationOrderSchema.make({
          kind: coworkReservationKind,
          ...base,
          ...basicProduct,
          date,
        }),
      plus: (plusProduct) =>
        normalizedPlusCoworkReservationOrderSchema.make({
          kind: coworkReservationKind,
          ...base,
          ...plusProduct,
          date,
        }),
      profi: (profiProduct) =>
        normalizedProfiCoworkReservationOrderSchema.make({
          kind: coworkReservationKind,
          ...base,
          ...profiProduct,
          date,
        }),
    })
  );
};

const decodeCoworkReservationOrder = Schema.decodeUnknownSync(
  coworkReservationOrderInputSchema
);

export const coworkReservationOrderSchema = coworkReservationOrderInputSchema
  .check(Schema.makeFilter(getCoworkReservationIssues))
  .pipe(
    Schema.decodeTo(normalizedCoworkReservationOrderSchema, {
      decode: SchemaGetter.transform(normalizeCoworkReservationOrder),
      encode: SchemaGetter.transform(decodeCoworkReservationOrder),
    })
  );

export const normalizeCoworkReservationForm = (
  data: CoworkReservationFormInput
): NormalizedCoworkReservationForm => ({
  ...normalizeCoworkReservationOrder(data),
  legalConsent: data.legalConsent,
});

export const getCoworkReservationOrder = (
  form: NormalizedCoworkReservationForm
): NormalizedCoworkReservationOrder =>
  Match.value(form).pipe(
    Match.discriminatorsExhaustive("entryTier")({
      basic: ({ legalConsent: _, ...reservation }) =>
        normalizedBasicCoworkReservationOrderSchema.make(reservation),
      plus: ({ legalConsent: _, ...reservation }) =>
        normalizedPlusCoworkReservationOrderSchema.make(reservation),
      profi: ({ legalConsent: _, ...reservation }) =>
        normalizedProfiCoworkReservationOrderSchema.make(reservation),
    })
  );

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
export {
  getAllowedMonitorOptionsForCoworkTier,
  getCoworkReservationProductCoffee,
  getCoworkReservationProductMonitorOption,
  getCoworkTierIncludesCourtesyCoffee,
  getCoworkTierRequiresMonitorOption,
};
