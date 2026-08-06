import { Schema, SchemaGetter } from "effect";
import { m } from "@/features/i18n";
import { reservationLegalConsentSchema } from "@/features/reservation/reservation-consent";
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

export const officeAdditionalGuestsSchema = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0, {
    message: m.reservationValidationOfficeAdditionalGuests(),
  })
).annotate({
  identifier: "OfficeAdditionalGuests",
  description:
    "Number of office guests in addition to the customer making the reservation.",
});

export const workspaceOfficeProductIdentitySchema = Schema.Struct({
  kind: Schema.Literal(officeReservationKind),
});

export type WorkspaceOfficeProductIdentity =
  typeof workspaceOfficeProductIdentitySchema.Type;

export const workspaceOfficeProductKeySchema = Schema.Literal(
  officeReservationKind
);

export type WorkspaceOfficeProductKey =
  typeof workspaceOfficeProductKeySchema.Type;

export const getWorkspaceOfficeProductKey = (
  _product: WorkspaceOfficeProductIdentity
): WorkspaceOfficeProductKey => officeReservationKind;

const officeDateSchema = Schema.String.check(
  isPlainDateString({ message: m.reservationValidationDateRequired() })
);

type OfficeReservationSelectionInput = {
  readonly startsOn: string;
  readonly endsOn: string;
};

const officeReservationSelectionChecks = [
  Schema.makeFilter<OfficeReservationSelectionInput>(
    ({ endsOn, startsOn }) =>
      startsOn === "" ||
      endsOn === "" ||
      endsOn >= startsOn || {
        path: ["endsOn"],
        issue: m.reservationValidationOfficeEndBeforeStart(),
      }
  ),
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
  additionalGuests: officeAdditionalGuestsSchema,
} as const;

const officeReservationOrderBaseSchema = Schema.Struct({
  ...reservationCustomerSchema.fields,
  ...officeReservationSelectionFields,
}).check(...officeReservationSelectionChecks);

export const officeReservationOrderInputSchema = Schema.Struct({
  kind: Schema.Literal(officeReservationKind),
  ...officeReservationOrderBaseSchema.fields,
}).check(...officeReservationSelectionChecks);

export const officeReservationFormInputSchema = Schema.Struct({
  ...officeReservationOrderBaseSchema.fields,
  legalConsent: reservationLegalConsentSchema,
  marketingConsent: Schema.Boolean,
}).check(...officeReservationSelectionChecks);

export type OfficeReservationOrderInput =
  typeof officeReservationOrderInputSchema.Type;
export type OfficeReservationFormInput =
  typeof officeReservationFormInputSchema.Type;

export const normalizedOfficeReservationOrderSchema = Schema.Struct({
  kind: Schema.Literal(officeReservationKind),
  ...normalizedReservationCustomerSchema.fields,
  startsOn: plainDateStringSchema,
  endsOn: plainDateStringSchema,
  additionalGuests: officeAdditionalGuestsSchema,
});

export const normalizedOfficeReservationFormSchema = Schema.Struct({
  ...normalizedOfficeReservationOrderSchema.fields,
  legalConsent: Schema.Boolean,
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
  additionalGuests: officeAdditionalGuestsSchema,
}).annotate({
  identifier: "OfficeReservationDetails",
  description: "PII-free office reservation projection for external consumers.",
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
    "kind" | "startsOn" | "endsOn" | "additionalGuests"
  >
): OfficeReservationDetails =>
  officeReservationDetailsSchema.make({
    kind: officeReservationKind,
    startsOn: reservation.startsOn,
    endsOn: reservation.endsOn,
    additionalGuests: reservation.additionalGuests,
  });

export const getOfficeAdvertisedPriceReservation = (
  reservation: Pick<
    NormalizedOfficeReservationOrder,
    "startsOn" | "endsOn" | "additionalGuests"
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

export const getOfficeReservationProductCoffee = (
  _reservation: Pick<OfficeReservationOrderInput, "kind">
) => false;

export const getOfficeReservationProductMonitorOption = (
  _reservation: Pick<OfficeReservationOrderInput, "kind">
) => undefined;

export const getOfficeReservationGuestCount = (
  reservation: Pick<OfficeReservationDetails, "additionalGuests">
) => reservation.additionalGuests + 1;

export const getOfficeAdditionalSeatOptions = (seatCapacity: number) =>
  Array.from({ length: seatCapacity }, (_, additionalGuests) =>
    officeAdditionalGuestsSchema.make(additionalGuests)
  );

export const getOfficeReservationDayCount = (
  reservation: Pick<OfficeReservationDetails, "startsOn" | "endsOn">
) =>
  Temporal.PlainDate.from(reservation.startsOn).until(
    Temporal.PlainDate.from(reservation.endsOn),
    { largestUnit: "day" }
  ).days + 1;

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
    additionalGuests: reservation.additionalGuests,
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
  legalConsent: reservation.legalConsent,
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
  additionalGuests: 0,
  name: "",
  email: "",
  phone: "",
  message: "",
  legalConsent: false,
  marketingConsent: false,
};

export const getOfficeReservationOrder = (
  form: NormalizedOfficeReservationForm
): NormalizedOfficeReservationOrder => {
  const { legalConsent: _, marketingConsent: __, ...reservation } = form;
  return normalizedOfficeReservationOrderSchema.make(reservation);
};

export const getOfficeReservationDefaultValues = (
  reservation: NormalizedOfficeReservationOrder
): OfficeReservationInput => ({
  startsOn: reservation.startsOn,
  endsOn: reservation.endsOn,
  additionalGuests: reservation.additionalGuests,
  name: reservation.name,
  email: reservation.email,
  phone: reservation.phone,
  ...(reservation.message !== undefined && { message: reservation.message }),
  legalConsent: false,
  marketingConsent: false,
});
