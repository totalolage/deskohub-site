import { Schema, SchemaGetter } from "effect";
import { m } from "@/features/i18n";
import {
  normalizedReservationCustomerSchema,
  reservationCustomerSchema,
} from "@/features/reservation/reservation-contact";
import type { ReservationInterval } from "@/features/reservation/reservation-interval-domain";
import { officeReservationKind } from "@/features/reservation/reservation-kind";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  instantStringSchema,
  isPlainDateString,
  plainDateStringSchema,
} from "@/shared/utils/temporal";

const decodeInstant = Schema.decodeUnknownSync(instantStringSchema);
const decodePlainDate = Schema.decodeUnknownSync(plainDateStringSchema);

export const officeSeatsSchema = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1, {
    message: m.reservationValidationOfficeSeats(),
  })
).annotate({
  identifier: "OfficeSeats",
  description: "Total number of seats reserved in the office.",
});

export const officeReservationDayCountSchema = Schema.Int.check(
  Schema.isGreaterThan(0)
).annotate({
  identifier: "OfficeReservationDayCount",
  description: "Inclusive number of whole calendar days reserved.",
});

export const workspaceOfficeProductIdentitySchema = Schema.Struct({
  kind: Schema.Literal(officeReservationKind),
  seats: officeSeatsSchema,
  dayCount: officeReservationDayCountSchema,
});

export type WorkspaceOfficeProductIdentity =
  typeof workspaceOfficeProductIdentitySchema.Type;

export const workspaceOfficeProductTargetSchema = Schema.Struct({
  kind: workspaceOfficeProductIdentitySchema.fields.kind,
});

export type WorkspaceOfficeProductTarget =
  typeof workspaceOfficeProductTargetSchema.Type;

export const workspaceOfficeProductKeySchema = Schema.TemplateLiteral([
  workspaceOfficeProductIdentitySchema.fields.kind,
  ":",
  workspaceOfficeProductIdentitySchema.fields.seats,
  ":",
  workspaceOfficeProductIdentitySchema.fields.dayCount,
]);

export type WorkspaceOfficeProductKey =
  typeof workspaceOfficeProductKeySchema.Type;

export const getWorkspaceOfficeProductKey = (
  product: WorkspaceOfficeProductIdentity
): WorkspaceOfficeProductKey =>
  `${product.kind}:${product.seats}:${product.dayCount}`;

export const getWorkspaceOfficeProductIdentity = (
  product: Pick<WorkspaceOfficeProductIdentity, "seats" | "dayCount">
): WorkspaceOfficeProductIdentity =>
  workspaceOfficeProductIdentitySchema.make({
    kind: officeReservationKind,
    seats: product.seats,
    dayCount: product.dayCount,
  });

const officeDateSchema = Schema.String.check(
  isPlainDateString({ message: m.reservationValidationDateRequired() })
);

type OfficeReservationSelectionInput = {
  readonly startsOn: string;
  readonly endsOn: string;
};

const officeReservationRangeChecks = [
  Schema.makeFilter<OfficeReservationSelectionInput>(
    ({ endsOn, startsOn }) =>
      startsOn === "" ||
      endsOn === "" ||
      endsOn >= startsOn || {
        path: ["endsOn"],
        issue: m.reservationValidationOfficeEndBeforeStart(),
      }
  ),
] as const;

const officeReservationInputChecks = [
  ...officeReservationRangeChecks,
  Schema.makeFilter<OfficeReservationSelectionInput>(
    ({ endsOn }) =>
      endsOn === "" ||
      Temporal.PlainDate.from(endsOn)
        .add({ days: 1 })
        .toZonedDateTime(workspaceSiteConstants.location.timeZone)
        .toInstant().epochMilliseconds >=
        Temporal.Now.instant().epochMilliseconds || {
        path: ["endsOn"],
        issue: m.reservationValidationOfficeEnded(),
      }
  ),
] as const;

const officeReservationSelectionFields = {
  startsOn: officeDateSchema,
  endsOn: officeDateSchema,
  seats: officeSeatsSchema,
} as const;

const officeReservationOrderBaseSchema = Schema.Struct({
  ...reservationCustomerSchema.fields,
  ...officeReservationSelectionFields,
});

export const officeReservationOrderInputSchema = Schema.Struct({
  kind: Schema.Literal(officeReservationKind),
  ...officeReservationOrderBaseSchema.fields,
}).check(...officeReservationInputChecks);

export const officeReservationFormInputSchema = Schema.Struct({
  ...officeReservationOrderBaseSchema.fields,
  marketingConsent: Schema.Boolean,
}).check(...officeReservationInputChecks);

export type OfficeReservationOrderInput =
  typeof officeReservationOrderInputSchema.Type;
export type OfficeReservationFormInput =
  typeof officeReservationFormInputSchema.Type;

export const normalizedOfficeReservationOrderSchema = Schema.Struct({
  kind: Schema.Literal(officeReservationKind),
  ...normalizedReservationCustomerSchema.fields,
  startsOn: plainDateStringSchema,
  endsOn: plainDateStringSchema,
  seats: officeSeatsSchema,
});

export const normalizedOfficeReservationFormSchema = Schema.Struct({
  ...normalizedOfficeReservationOrderSchema.fields,
  marketingConsent: Schema.Boolean,
});

export type NormalizedOfficeReservationOrder =
  typeof normalizedOfficeReservationOrderSchema.Type;
export type NormalizedOfficeReservationForm =
  typeof normalizedOfficeReservationFormSchema.Type;

export const officeReservationDetailsSchema = Schema.Struct({
  kind: Schema.Literal(officeReservationKind),
  startsOn: plainDateStringSchema,
  endsOn: plainDateStringSchema,
  seats: officeSeatsSchema,
})
  .check(...officeReservationRangeChecks)
  .annotate({
    identifier: "OfficeReservationDetails",
    description:
      "PII-free office reservation projection for external consumers.",
  });

export type OfficeReservationDetails =
  typeof officeReservationDetailsSchema.Type;

export type OfficeReservationPricingInput = OfficeReservationDetails;

export const officeAdvertisedPriceReservationSchema = Schema.Struct({
  kind: Schema.Literal(officeReservationKind),
  details: officeReservationDetailsSchema,
}).annotate({
  identifier: "OfficeAdvertisedPriceReservation",
  description:
    "PII-free normalized office reservation inputs whose price is advertised.",
});

export type OfficeAdvertisedPriceReservation =
  typeof officeAdvertisedPriceReservationSchema.Type;

export const officeAdvertisedPriceReservationEquals = Schema.toEquivalence(
  officeAdvertisedPriceReservationSchema
);

export const getOfficeReservationDetails = (
  reservation: Pick<
    NormalizedOfficeReservationOrder,
    "kind" | "startsOn" | "endsOn" | "seats"
  >
): OfficeReservationDetails =>
  officeReservationDetailsSchema.make({
    kind: officeReservationKind,
    startsOn: reservation.startsOn,
    endsOn: reservation.endsOn,
    seats: reservation.seats,
  });

export const getOfficeAdvertisedPriceReservation = (
  reservation: Pick<
    NormalizedOfficeReservationOrder,
    "startsOn" | "endsOn" | "seats"
  >
): OfficeAdvertisedPriceReservation => ({
  kind: officeReservationKind,
  details: getOfficeReservationDetails({
    kind: officeReservationKind,
    ...reservation,
  }),
});

export const storedOfficeReservationDetailsSchema = Schema.Struct({
  kind: workspaceOfficeProductIdentitySchema.fields.kind,
}).annotate({
  identifier: "StoredOfficeReservationDetails",
  description:
    "App-owned office family discriminator without Dotypos-owned reservation facts.",
});

export type StoredOfficeReservationDetails =
  typeof storedOfficeReservationDetailsSchema.Type;

export const getStoredOfficeReservationDetails = (
  _reservation: Pick<OfficeReservationOrderInput, "kind">
): StoredOfficeReservationDetails => ({ kind: officeReservationKind });

export const getOfficeSeatOptions = (seatCapacity: number) =>
  Array.from({ length: seatCapacity }, (_, index) =>
    officeSeatsSchema.make(index + 1)
  );

export const getOfficeReservationDayCount = (
  reservation: Pick<OfficeReservationDetails, "startsOn" | "endsOn">
) =>
  Temporal.PlainDate.from(reservation.startsOn).until(
    Temporal.PlainDate.from(reservation.endsOn),
    { largestUnit: "day" }
  ).days + 1;

export const getOfficeReservationProductIdentity = (
  reservation: Pick<OfficeReservationDetails, "startsOn" | "endsOn" | "seats">
): WorkspaceOfficeProductIdentity =>
  getWorkspaceOfficeProductIdentity({
    seats: reservation.seats,
    dayCount: getOfficeReservationDayCount(reservation),
  });

export const getOfficeReservationIntervalInput = (
  reservation: Pick<OfficeReservationDetails, "startsOn" | "endsOn">
): ReservationInterval => ({
  startsAt: decodeInstant(
    Temporal.PlainDate.from(reservation.startsOn)
      .toZonedDateTime(workspaceSiteConstants.location.timeZone)
      .toInstant()
      .toString()
  ),
  endsAt: decodeInstant(
    Temporal.PlainDate.from(reservation.endsOn)
      .add({ days: 1 })
      .toZonedDateTime(workspaceSiteConstants.location.timeZone)
      .toInstant()
      .toString()
  ),
});

export const hasOfficeReservationEnded = (
  reservation: Pick<OfficeReservationDetails, "endsOn">,
  now = Temporal.Now.instant()
) =>
  Temporal.Instant.compare(
    Temporal.PlainDate.from(reservation.endsOn)
      .add({ days: 1 })
      .toZonedDateTime(workspaceSiteConstants.location.timeZone)
      .toInstant(),
    now
  ) < 0;

export const normalizeOfficeReservationOrder = (
  reservation: OfficeReservationOrderInput | OfficeReservationFormInput
): NormalizedOfficeReservationOrder =>
  normalizedOfficeReservationOrderSchema.make({
    kind: officeReservationKind,
    name: reservation.name,
    email: reservation.email,
    phone: reservation.phone,
    ...(reservation.message !== undefined && { message: reservation.message }),
    startsOn: decodePlainDate(reservation.startsOn),
    endsOn: decodePlainDate(reservation.endsOn),
    seats: reservation.seats,
  });

const decodeOfficeReservationOrder = Schema.decodeUnknownSync(
  officeReservationOrderInputSchema
);

export const officeReservationOrderSchema =
  officeReservationOrderInputSchema.pipe(
    Schema.decodeTo(normalizedOfficeReservationOrderSchema, {
      decode: SchemaGetter.transform(normalizeOfficeReservationOrder),
      encode: SchemaGetter.transform(decodeOfficeReservationOrder),
    })
  );

export const normalizeOfficeReservationForm = (
  reservation: OfficeReservationFormInput
): NormalizedOfficeReservationForm => ({
  ...normalizeOfficeReservationOrder(reservation),
  marketingConsent: reservation.marketingConsent,
});

export const officeReservationSchema = officeReservationFormInputSchema.pipe(
  Schema.decodeTo(normalizedOfficeReservationFormSchema, {
    decode: SchemaGetter.transform(normalizeOfficeReservationForm),
    encode: SchemaGetter.transform(
      (reservation): OfficeReservationFormInput => reservation
    ),
  })
);

export type OfficeReservationInput = typeof officeReservationSchema.Encoded;
export type OfficeReservationData = typeof officeReservationSchema.Type;

export const officeReservationDefaultValues: OfficeReservationInput = {
  startsOn: "",
  endsOn: "",
  seats: 1,
  name: "",
  email: "",
  phone: "",
  message: "",
  marketingConsent: false,
};

export const getOfficeReservationOrder = (
  form: NormalizedOfficeReservationForm
): NormalizedOfficeReservationOrder => {
  const { marketingConsent: _, ...reservation } = form;
  return normalizedOfficeReservationOrderSchema.make(reservation);
};

export const getOfficeReservationDefaultValues = (
  reservation: NormalizedOfficeReservationOrder
): OfficeReservationInput => ({
  startsOn: reservation.startsOn,
  endsOn: reservation.endsOn,
  seats: reservation.seats,
  name: reservation.name,
  email: reservation.email,
  phone: reservation.phone,
  ...(reservation.message !== undefined && { message: reservation.message }),
  marketingConsent: false,
});
