import { Match, Schema, SchemaGetter } from "effect";
import type { WorkspaceProductMonitorOption } from "@/features/checkout/product-catalog";
import { m } from "@/features/i18n";
import {
  coworkReservationProductInputSchema,
  getAllowedMonitorOptionsForCoworkTier,
  getCoworkReservationProductCoffee,
  getCoworkReservationProductIssues,
  getCoworkReservationProductMonitorOption,
  normalizeCoworkReservationProduct,
  normalizedBasicCoworkReservationProductSchema,
  normalizedOpenSpaceCoworkReservationProductSchema,
  normalizedPlusCoworkReservationProductSchema,
  normalizedProfiCoworkReservationProductSchema,
  normalizedReservedDeskCoworkReservationProductSchema,
  type WorkspaceCoworkCurrentTier,
  type WorkspaceCoworkProductTier,
} from "@/features/reservation/cowork-reservation-product";
import {
  defaultReservationBillingSelection,
  normalizedReservationBillingSelectionSchema,
  reservationBillingSelectionInputSchema,
} from "@/features/reservation/reservation-billing";
import {
  droppingRetiredReservationCustomerMessage,
  normalizedReservationCustomerSchema,
  reservationCustomerSchema,
} from "@/features/reservation/reservation-contact";
import {
  getCurrentWorkspaceDate,
  isTodayOrFutureWorkspaceDate,
} from "@/features/reservation/reservation-date";
import type { ReservationIntervalInput } from "@/features/reservation/reservation-interval-domain";
import { coworkReservationKind } from "@/features/reservation/reservation-kind";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  isPlainDateString,
  localDateTimeSchema,
  plainDateStringSchema,
} from "@/shared/utils/temporal";

const decodeLocalDateTime = Schema.decodeUnknownSync(localDateTimeSchema);
const decodePlainDate = Schema.decodeUnknownSync(plainDateStringSchema);

const openSpaceExclusiveEndHour = 17;

/**
 * Shared tier-aware cowork interval constructor used by availability,
 * assignment/hold creation, and recovery. Open Space spans Prague-local
 * 00:00 until 17:00 exclusive on the reserved date; every other tier spans
 * Prague midnight to the next midnight (DST-correct calendar day).
 */
export const getCoworkReservationIntervalInput = (
  tier: WorkspaceCoworkProductTier | undefined,
  date: string
): ReservationIntervalInput => {
  if (tier === "open-space") {
    return {
      startsAt: decodeLocalDateTime(`${date}T00:00`),
      endsAt: decodeLocalDateTime(`${date}T${openSpaceExclusiveEndHour}:00`),
    };
  }

  return {
    startsAt: decodeLocalDateTime(`${date}T00:00`),
    endsAt: decodeLocalDateTime(
      `${Temporal.PlainDate.from(date).add({ days: 1 })}T00:00`
    ),
  };
};

const dateSchema = Schema.String.check(
  isPlainDateString({
    message: m.reservationValidationDateRequired(),
  }),
  Schema.makeFilter(isTodayOrFutureWorkspaceDate, {
    message: m.reservationValidationDatePast(),
  })
);

/**
 * Same-day cutoff for Open Space: submission and final new payment
 * initiation fail when the current Prague time is at or after 17:00 on the
 * reserved date. Future dates are never blocked.
 */
export const isCoworkOpenSpaceDayCutoffReached = (input: {
  readonly entryTier: WorkspaceCoworkProductTier;
  readonly date: string;
  readonly now?: Temporal.Instant;
}) => {
  if (input.entryTier !== "open-space") return false;

  const now = input.now ?? Temporal.Now.instant();
  const today = getCurrentWorkspaceDate(now);
  if (input.date !== today.toString()) return false;

  const cutoff = today
    .toZonedDateTime(workspaceSiteConstants.location.timeZone)
    .with({
      hour: openSpaceExclusiveEndHour,
      minute: 0,
      second: 0,
      millisecond: 0,
      microsecond: 0,
      nanosecond: 0,
    });

  return Temporal.Instant.compare(now, cutoff.toInstant()) >= 0;
};

const getCoworkReservationDateIssues = (data: {
  readonly entryTier: WorkspaceCoworkProductTier;
  readonly date: string;
}): readonly Schema.FilterIssue[] =>
  isCoworkOpenSpaceDayCutoffReached(data)
    ? [
        {
          path: ["date"],
          issue: m.reservationValidationOpenSpaceDayEnded(),
        },
      ]
    : [];

const coworkReservationOrderBaseSchema = Schema.Struct({
  ...reservationCustomerSchema.fields,
  billing: reservationBillingSelectionInputSchema,
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
    marketingConsent: Schema.Boolean,
  }));

export type CoworkReservationOrderInput =
  typeof coworkReservationOrderInputSchema.Type;
export type CoworkReservationFormInput =
  typeof coworkReservationFormInputSchema.Type;

export const normalizedOpenSpaceCoworkReservationOrderSchema = Schema.Struct({
  kind: Schema.Literal(coworkReservationKind),
  ...normalizedReservationCustomerSchema.fields,
  billing: normalizedReservationBillingSelectionSchema,
  ...normalizedOpenSpaceCoworkReservationProductSchema.fields,
  date: plainDateStringSchema,
});

export const normalizedReservedDeskCoworkReservationOrderSchema = Schema.Struct(
  {
    kind: Schema.Literal(coworkReservationKind),
    ...normalizedReservationCustomerSchema.fields,
    billing: normalizedReservationBillingSelectionSchema,
    ...normalizedReservedDeskCoworkReservationProductSchema.fields,
    date: plainDateStringSchema,
  }
);

export const normalizedBasicCoworkReservationOrderSchema = Schema.Struct({
  kind: Schema.Literal(coworkReservationKind),
  ...normalizedReservationCustomerSchema.fields,
  billing: normalizedReservationBillingSelectionSchema,
  ...normalizedBasicCoworkReservationProductSchema.fields,
  date: plainDateStringSchema,
});

export const normalizedPlusCoworkReservationOrderSchema = Schema.Struct({
  kind: Schema.Literal(coworkReservationKind),
  ...normalizedReservationCustomerSchema.fields,
  billing: normalizedReservationBillingSelectionSchema,
  ...normalizedPlusCoworkReservationProductSchema.fields,
  date: plainDateStringSchema,
});

export const normalizedProfiCoworkReservationOrderSchema = Schema.Struct({
  kind: Schema.Literal(coworkReservationKind),
  ...normalizedReservationCustomerSchema.fields,
  billing: normalizedReservationBillingSelectionSchema,
  ...normalizedProfiCoworkReservationProductSchema.fields,
  date: plainDateStringSchema,
});

export const normalizedCoworkReservationOrderSchema =
  droppingRetiredReservationCustomerMessage(
    Schema.Union([
      normalizedOpenSpaceCoworkReservationOrderSchema,
      normalizedReservedDeskCoworkReservationOrderSchema,
      normalizedBasicCoworkReservationOrderSchema,
      normalizedPlusCoworkReservationOrderSchema,
      normalizedProfiCoworkReservationOrderSchema,
    ])
  );

export const normalizedCoworkReservationFormSchema = Schema.Union([
  Schema.Struct({
    ...normalizedOpenSpaceCoworkReservationOrderSchema.fields,
    marketingConsent: Schema.Boolean,
  }),
  Schema.Struct({
    ...normalizedReservedDeskCoworkReservationOrderSchema.fields,
    marketingConsent: Schema.Boolean,
  }),
  Schema.Struct({
    ...normalizedBasicCoworkReservationOrderSchema.fields,
    marketingConsent: Schema.Boolean,
  }),
  Schema.Struct({
    ...normalizedPlusCoworkReservationOrderSchema.fields,
    marketingConsent: Schema.Boolean,
  }),
  Schema.Struct({
    ...normalizedProfiCoworkReservationOrderSchema.fields,
    marketingConsent: Schema.Boolean,
  }),
]);

// Public issuance only ever produces the current offers; the full form union
// above stays decodable for historical truth.
export const normalizedCurrentCoworkReservationFormSchema = Schema.Union([
  Schema.Struct({
    ...normalizedOpenSpaceCoworkReservationOrderSchema.fields,
    marketingConsent: Schema.Boolean,
  }),
  Schema.Struct({
    ...normalizedReservedDeskCoworkReservationOrderSchema.fields,
    marketingConsent: Schema.Boolean,
  }),
]);

export type NormalizedCoworkReservationOrder =
  typeof normalizedCoworkReservationOrderSchema.Type;
export type NormalizedCoworkReservationForm =
  typeof normalizedCoworkReservationFormSchema.Type;
export type NormalizedCurrentCoworkReservationForm =
  typeof normalizedCurrentCoworkReservationFormSchema.Type;

const coworkReservationDetailsDateSchema = Schema.toEncoded(
  plainDateStringSchema
);

const openSpaceCoworkReservationDetailsSchema = Schema.Struct({
  kind: Schema.Literal(coworkReservationKind),
  ...normalizedOpenSpaceCoworkReservationProductSchema.fields,
  date: coworkReservationDetailsDateSchema,
});

const reservedDeskCoworkReservationDetailsSchema = Schema.Struct({
  kind: Schema.Literal(coworkReservationKind),
  ...normalizedReservedDeskCoworkReservationProductSchema.fields,
  date: coworkReservationDetailsDateSchema,
});

const basicCoworkReservationDetailsSchema = Schema.Struct({
  kind: Schema.Literal(coworkReservationKind),
  ...normalizedBasicCoworkReservationProductSchema.fields,
  date: coworkReservationDetailsDateSchema,
});

const plusCoworkReservationDetailsSchema = Schema.Struct({
  kind: Schema.Literal(coworkReservationKind),
  ...normalizedPlusCoworkReservationProductSchema.fields,
  date: coworkReservationDetailsDateSchema,
});

const profiCoworkReservationDetailsSchema = Schema.Struct({
  kind: Schema.Literal(coworkReservationKind),
  ...normalizedProfiCoworkReservationProductSchema.fields,
  date: coworkReservationDetailsDateSchema,
});

export const coworkReservationDetailsSchema = Schema.Union([
  openSpaceCoworkReservationDetailsSchema,
  reservedDeskCoworkReservationDetailsSchema,
  basicCoworkReservationDetailsSchema,
  plusCoworkReservationDetailsSchema,
  profiCoworkReservationDetailsSchema,
]).annotate({
  identifier: "CoworkReservationDetails",
  description: "PII-free cowork reservation projection for external consumers.",
});

export type CoworkReservationDetails =
  typeof coworkReservationDetailsSchema.Type;

const openSpaceCoworkAdvertisedPriceDetailsSchema = Schema.Struct({
  kind: Schema.Literal(coworkReservationKind),
  entryTier: Schema.Literal("open-space"),
  coffee: normalizedOpenSpaceCoworkReservationProductSchema.fields.coffee,
  date: coworkReservationDetailsDateSchema,
});

const reservedDeskCoworkAdvertisedPriceDetailsSchema = Schema.Struct({
  kind: Schema.Literal(coworkReservationKind),
  entryTier: Schema.Literal("reserved-desk"),
  workstation: Schema.Boolean,
  date: coworkReservationDetailsDateSchema,
});

const basicCoworkAdvertisedPriceDetailsSchema = Schema.Struct({
  kind: Schema.Literal(coworkReservationKind),
  entryTier: normalizedBasicCoworkReservationProductSchema.fields.entryTier,
  coffee: normalizedBasicCoworkReservationProductSchema.fields.coffee,
  date: coworkReservationDetailsDateSchema,
});

const plusCoworkAdvertisedPriceDetailsSchema = Schema.Struct({
  kind: Schema.Literal(coworkReservationKind),
  entryTier: normalizedPlusCoworkReservationProductSchema.fields.entryTier,
  coffee: normalizedPlusCoworkReservationProductSchema.fields.coffee,
  date: coworkReservationDetailsDateSchema,
});

const profiCoworkAdvertisedPriceDetailsSchema = Schema.Struct({
  kind: Schema.Literal(coworkReservationKind),
  entryTier: normalizedProfiCoworkReservationProductSchema.fields.entryTier,
  coffee: normalizedProfiCoworkReservationProductSchema.fields.coffee,
  date: coworkReservationDetailsDateSchema,
});

export const coworkAdvertisedPriceDetailsSchema = Schema.Union([
  openSpaceCoworkAdvertisedPriceDetailsSchema,
  reservedDeskCoworkAdvertisedPriceDetailsSchema,
  basicCoworkAdvertisedPriceDetailsSchema,
  plusCoworkAdvertisedPriceDetailsSchema,
  profiCoworkAdvertisedPriceDetailsSchema,
]).annotate({
  identifier: "CoworkAdvertisedPriceDetails",
  description: "Cowork reservation inputs that determine the advertised price.",
});

export type CoworkAdvertisedPriceDetails =
  typeof coworkAdvertisedPriceDetailsSchema.Type;

export const coworkAdvertisedPriceReservationSchema = Schema.Struct({
  kind: Schema.Literal(coworkReservationKind),
  details: coworkAdvertisedPriceDetailsSchema,
}).annotate({
  identifier: "CoworkAdvertisedPriceReservation",
  description:
    "Normalized cowork reservation inputs whose price is advertised.",
});

export type CoworkAdvertisedPriceReservation =
  typeof coworkAdvertisedPriceReservationSchema.Type;

export const coworkAdvertisedPriceReservationEquals = Schema.toEquivalence(
  coworkAdvertisedPriceReservationSchema
);

export const getCoworkAdvertisedPriceReservation = <
  const Reservation extends {
    readonly entryTier: WorkspaceCoworkProductTier;
    readonly coffee: boolean;
    readonly date: string;
    readonly monitorOption?: WorkspaceProductMonitorOption;
  },
>(
  reservation: Reservation
): CoworkAdvertisedPriceReservation => ({
  kind: coworkReservationKind,
  details: Match.value(reservation.entryTier).pipe(
    Match.when("open-space", () =>
      openSpaceCoworkAdvertisedPriceDetailsSchema.make({
        kind: coworkReservationKind,
        entryTier: "open-space",
        coffee: reservation.coffee,
        date: reservation.date,
      })
    ),
    Match.when("reserved-desk", () =>
      reservedDeskCoworkAdvertisedPriceDetailsSchema.make({
        kind: coworkReservationKind,
        entryTier: "reserved-desk",
        workstation: reservation.monitorOption !== undefined,
        date: reservation.date,
      })
    ),
    Match.when("basic", () =>
      basicCoworkAdvertisedPriceDetailsSchema.make({
        kind: coworkReservationKind,
        entryTier: "basic",
        coffee: reservation.coffee,
        date: reservation.date,
      })
    ),
    Match.when("plus", () =>
      plusCoworkAdvertisedPriceDetailsSchema.make({
        kind: coworkReservationKind,
        entryTier: "plus",
        coffee: true,
        date: reservation.date,
      })
    ),
    Match.when("profi", () =>
      profiCoworkAdvertisedPriceDetailsSchema.make({
        kind: coworkReservationKind,
        entryTier: "profi",
        coffee: true,
        date: reservation.date,
      })
    ),
    Match.exhaustive
  ),
});

export const getCoworkReservationDetails = (
  reservation: NormalizedCoworkReservationOrder
): CoworkReservationDetails =>
  Match.value(reservation).pipe(
    Match.discriminatorsExhaustive("entryTier")({
      "open-space": (openSpaceReservation) =>
        openSpaceCoworkReservationDetailsSchema.make({
          kind: coworkReservationKind,
          entryTier: openSpaceReservation.entryTier,
          date: openSpaceReservation.date,
          coffee: openSpaceReservation.coffee,
        }),
      "reserved-desk": (reservedDeskReservation) =>
        reservedDeskCoworkReservationDetailsSchema.make({
          kind: coworkReservationKind,
          entryTier: reservedDeskReservation.entryTier,
          date: reservedDeskReservation.date,
          coffee: true,
          monitorOption: reservedDeskReservation.monitorOption,
        }),
      basic: (basicReservation) =>
        basicCoworkReservationDetailsSchema.make({
          kind: coworkReservationKind,
          entryTier: basicReservation.entryTier,
          date: basicReservation.date,
          coffee: basicReservation.coffee,
        }),
      plus: (plusReservation) =>
        plusCoworkReservationDetailsSchema.make({
          kind: coworkReservationKind,
          entryTier: plusReservation.entryTier,
          date: plusReservation.date,
          coffee: true,
        }),
      profi: (profiReservation) =>
        profiCoworkReservationDetailsSchema.make({
          kind: coworkReservationKind,
          entryTier: profiReservation.entryTier,
          date: profiReservation.date,
          coffee: true,
          monitorOption: profiReservation.monitorOption,
        }),
    })
  );

export type CoworkCheckoutAttemptDetails = {
  readonly kind: NormalizedCoworkReservationOrder["kind"];
  readonly date: NormalizedCoworkReservationOrder["date"];
  readonly entryTier: NormalizedCoworkReservationOrder["entryTier"];
  readonly coffee: boolean;
  readonly monitorOption: WorkspaceProductMonitorOption | null;
};

export const getCoworkCheckoutAttemptDetails = (
  reservation: NormalizedCoworkReservationOrder
): CoworkCheckoutAttemptDetails => ({
  kind: reservation.kind,
  date: reservation.date,
  entryTier: reservation.entryTier,
  coffee: reservation.coffee,
  monitorOption: reservation.monitorOption ?? null,
});

export const getCoworkReservationIssues = (
  data: CoworkReservationOrderInput | CoworkReservationFormInput
): readonly Schema.FilterIssue[] => [
  ...getCoworkReservationProductIssues(data),
  ...getCoworkReservationDateIssues(data),
];

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
    billing: data.billing ?? defaultReservationBillingSelection,
  };
  const product = normalizeCoworkReservationProduct(data);
  const date = decodePlainDate(data.date);

  return Match.value(product).pipe(
    Match.discriminatorsExhaustive("entryTier")({
      "open-space": (openSpaceProduct) =>
        normalizedOpenSpaceCoworkReservationOrderSchema.make({
          kind: coworkReservationKind,
          ...base,
          ...openSpaceProduct,
          date,
        }),
      "reserved-desk": (reservedDeskProduct) =>
        normalizedReservedDeskCoworkReservationOrderSchema.make({
          kind: coworkReservationKind,
          ...base,
          ...reservedDeskProduct,
          date,
        }),
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

// Public order issuance only produces the current offers.
export const normalizedCurrentCoworkReservationOrderSchema = Schema.Union([
  normalizedOpenSpaceCoworkReservationOrderSchema,
  normalizedReservedDeskCoworkReservationOrderSchema,
]);

export type NormalizedCurrentCoworkReservationOrder =
  typeof normalizedCurrentCoworkReservationOrderSchema.Type;

export const coworkCurrentReservationOrderSchema =
  coworkReservationOrderInputSchema
    .check(Schema.makeFilter(getCoworkReservationIssues))
    .pipe(
      Schema.decodeTo(normalizedCurrentCoworkReservationOrderSchema, {
        decode: SchemaGetter.transform(
          (data) =>
            normalizeCoworkReservationOrder(
              data
            ) as NormalizedCurrentCoworkReservationOrder
        ),
        encode: SchemaGetter.transform(decodeCoworkReservationOrder),
      })
    );

export const normalizeCoworkReservationForm = (
  data: CoworkReservationFormInput
): NormalizedCurrentCoworkReservationForm =>
  // Issuance input can only produce the current offers.
  ({
    ...normalizeCoworkReservationOrder(data),
    marketingConsent: data.marketingConsent,
  }) as NormalizedCurrentCoworkReservationForm;

export const getCoworkReservationOrder = (
  form: NormalizedCoworkReservationForm | NormalizedCurrentCoworkReservationForm
): NormalizedCoworkReservationOrder =>
  Match.value(form).pipe(
    Match.discriminatorsExhaustive("entryTier")({
      "open-space": ({ marketingConsent: _, ...reservation }) =>
        normalizedOpenSpaceCoworkReservationOrderSchema.make(reservation),
      "reserved-desk": ({ marketingConsent: _, ...reservation }) =>
        normalizedReservedDeskCoworkReservationOrderSchema.make(reservation),
      basic: ({ marketingConsent: _, ...reservation }) =>
        normalizedBasicCoworkReservationOrderSchema.make(reservation),
      plus: ({ marketingConsent: _, ...reservation }) =>
        normalizedPlusCoworkReservationOrderSchema.make(reservation),
      profi: ({ marketingConsent: _, ...reservation }) =>
        normalizedProfiCoworkReservationOrderSchema.make(reservation),
    })
  );

export const getCoworkCurrentReservationOrder = (
  form: NormalizedCurrentCoworkReservationForm
): NormalizedCurrentCoworkReservationOrder =>
  Match.value(form).pipe(
    Match.discriminatorsExhaustive("entryTier")({
      "open-space": ({ marketingConsent: _, ...reservation }) =>
        normalizedOpenSpaceCoworkReservationOrderSchema.make(reservation),
      "reserved-desk": ({ marketingConsent: _, ...reservation }) =>
        normalizedReservedDeskCoworkReservationOrderSchema.make(reservation),
    })
  );

const coworkReservationDraftSchema = coworkReservationFormInputSchema.check(
  Schema.makeFilter(getCoworkReservationIssues)
);

export const coworkReservationSchema = coworkReservationDraftSchema.pipe(
  Schema.decodeTo(normalizedCurrentCoworkReservationFormSchema, {
    decode: SchemaGetter.transform(normalizeCoworkReservationForm),
    encode: SchemaGetter.transform(
      (reservation): CoworkReservationFormInput => ({
        ...reservation,
        billing: reservation.billing ?? defaultReservationBillingSelection,
      })
    ),
  })
);

export type CoworkReservationInput = typeof coworkReservationSchema.Encoded;
export type CoworkReservationData = typeof coworkReservationSchema.Type;

export const coworkReservationDefaultValues: CoworkReservationInput = {
  entryTier: "open-space",
  date: "",
  coffee: false,
  monitorOption: undefined,
  name: "",
  email: "",
  phone: "",
  billing: defaultReservationBillingSelection,
  marketingConsent: false,
};

export {
  getCoworkTierIncludesCourtesyCoffee,
  getCoworkTierRequiresMonitorOption,
  getCoworkTierWorkstationAddon,
} from "@/features/checkout/product-catalog";
export type { WorkspaceCoworkCurrentTier, WorkspaceCoworkProductTier };
export {
  getAllowedMonitorOptionsForCoworkTier,
  getCoworkReservationProductCoffee,
  getCoworkReservationProductMonitorOption,
};
