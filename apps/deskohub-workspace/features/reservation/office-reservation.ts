import { Schema, SchemaGetter } from "effect";
import { m } from "@/features/i18n";
import {
  normalizedReservationCustomerSchema,
  reservationCustomerSchema,
} from "@/features/reservation/reservation-contact";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
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

type OfficeReservationRangeInput = {
  readonly startsOn: string;
  readonly endsOn: string;
};

const officeReservationRangeChecks = [
  Schema.makeFilter<OfficeReservationRangeInput>(
    ({ endsOn, startsOn }) =>
      startsOn === "" ||
      endsOn === "" ||
      endsOn >= startsOn || {
        path: ["endsOn"],
        issue: m.reservationValidationOfficeEndBeforeStart(),
      }
  ),
] as const;

const officeReservationOrderInputChecks = [
  ...officeReservationRangeChecks,
  Schema.makeFilter<OfficeReservationRangeInput>(
    ({ startsOn }) =>
      startsOn === "" ||
      isOfficeReservationStartOnOrAfterToday({ startsOn }) || {
        path: ["startsOn"],
        issue: m.reservationValidationOfficeStartPassed(),
      }
  ),
  Schema.makeFilter<OfficeReservationRangeInput>(
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
  Schema.makeFilter<OfficeReservationRangeInput>(
    ({ endsOn }) =>
      endsOn === "" ||
      isOfficeReservationWithinBookingHorizon({ endsOn }) || {
        path: ["endsOn"],
        issue: m.reservationValidationOfficeMaximumEnd(),
      }
  ),
] as const;

const officeReservationOrderSelectionFields = {
  startsOn: officeDateSchema,
  endsOn: officeDateSchema,
  seats: officeSeatsSchema,
} as const;

const officeReservationOrderBaseSchema = Schema.Struct({
  ...reservationCustomerSchema.fields,
  ...officeReservationOrderSelectionFields,
});

export const officeReservationOrderInputSchema = Schema.Struct({
  kind: Schema.Literal(officeReservationKind),
  ...officeReservationOrderBaseSchema.fields,
}).check(...officeReservationOrderInputChecks);

const officeReservationFormSelectionFields = {
  startsOn: officeDateSchema,
  dayCount: officeReservationDayCountSchema,
  seats: officeSeatsSchema,
} as const;

export const officeReservationFormInputSchema = Schema.Struct({
  ...reservationCustomerSchema.fields,
  ...officeReservationFormSelectionFields,
  marketingConsent: Schema.Boolean,
}).check(
  Schema.makeFilter(
    ({ startsOn }) =>
      startsOn === "" ||
      isOfficeReservationStartOnOrAfterToday({ startsOn }) || {
        path: ["startsOn"],
        issue: m.reservationValidationOfficeStartPassed(),
      }
  ),
  Schema.makeFilter(({ dayCount, startsOn }) => {
    if (startsOn === "") return true;

    const endsOn = getOfficeReservationEndsOn({ startsOn, dayCount });
    return (
      Temporal.PlainDate.from(endsOn)
        .add({ days: 1 })
        .toZonedDateTime(workspaceSiteConstants.location.timeZone)
        .toInstant().epochMilliseconds >=
        Temporal.Now.instant().epochMilliseconds || {
        path: ["startsOn"],
        issue: m.reservationValidationOfficeEnded(),
      }
    );
  }),
  Schema.makeFilter(
    ({ dayCount, startsOn }) =>
      startsOn === "" ||
      isOfficeReservationWithinBookingHorizon({
        endsOn: getOfficeReservationEndsOn({ startsOn, dayCount }),
      }) || {
        path: ["dayCount"],
        issue: m.reservationValidationOfficeMaximumEnd(),
      }
  )
);

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
  ...normalizedReservationCustomerSchema.fields,
  startsOn: plainDateStringSchema,
  dayCount: officeReservationDayCountSchema,
  seats: officeSeatsSchema,
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
})
  .check(
    Schema.makeFilter(({ details }) =>
      isOfficeReservationWithinBookingHorizon(details)
    )
  )
  .annotate({
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

export const getOfficeReservationDayCount = (reservation: {
  readonly startsOn: string;
  readonly endsOn: string;
}) =>
  Temporal.PlainDate.from(reservation.startsOn).until(
    Temporal.PlainDate.from(reservation.endsOn),
    { largestUnit: "day" }
  ).days + 1;

export const getOfficeReservationEndsOn = (reservation: {
  readonly startsOn: string;
  readonly dayCount: number;
}) =>
  Temporal.PlainDate.from(reservation.startsOn)
    .add({ days: reservation.dayCount - 1 })
    .toString();

export const getOfficeReservationMaximumEndsOn = (
  today = getCurrentWorkspaceDate()
) => today.add({ months: 1 });

export const isOfficeReservationStartOnOrAfterToday = (
  reservation: Pick<OfficeReservationRangeInput, "startsOn">,
  today = getCurrentWorkspaceDate()
) => reservation.startsOn >= today.toString();

export const isOfficeReservationWithinBookingHorizon = (
  reservation: Pick<OfficeReservationRangeInput, "endsOn">,
  today = getCurrentWorkspaceDate()
) =>
  Temporal.PlainDate.compare(
    Temporal.PlainDate.from(reservation.endsOn),
    getOfficeReservationMaximumEndsOn(today)
  ) <= 0;

export const getOfficeReservationMaximumDayCount = (input: {
  readonly startsOn: string;
  readonly maximumEndsOn: Temporal.PlainDate;
  readonly unavailableDates: readonly string[];
}) => {
  const startsOn = Temporal.PlainDate.from(input.startsOn);
  if (Temporal.PlainDate.compare(startsOn, input.maximumEndsOn) > 0) return 0;

  const maximumEndsOn = input.maximumEndsOn.toString();
  const firstUnavailableDate = input.unavailableDates
    .filter((date) => date >= input.startsOn && date <= maximumEndsOn)
    .sort()[0];
  const availableEndsOn = firstUnavailableDate
    ? Temporal.PlainDate.from(firstUnavailableDate).subtract({ days: 1 })
    : input.maximumEndsOn;

  if (Temporal.PlainDate.compare(availableEndsOn, startsOn) < 0) return 0;

  return startsOn.until(availableEndsOn, { largestUnit: "day" }).days + 1;
};

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
  reservation: OfficeReservationOrderInput
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
): NormalizedOfficeReservationForm =>
  normalizedOfficeReservationFormSchema.make({
    name: reservation.name,
    email: reservation.email,
    phone: reservation.phone,
    ...(reservation.message !== undefined && { message: reservation.message }),
    startsOn: decodePlainDate(reservation.startsOn),
    dayCount: reservation.dayCount,
    seats: reservation.seats,
    marketingConsent: reservation.marketingConsent,
  });

export const officeReservationSchema = officeReservationFormInputSchema.pipe(
  Schema.decodeTo(normalizedOfficeReservationFormSchema, {
    decode: SchemaGetter.transform(normalizeOfficeReservationForm),
    encode: SchemaGetter.transform(
      (reservation): OfficeReservationFormInput => ({
        name: reservation.name,
        email: reservation.email,
        phone: reservation.phone,
        ...(reservation.message !== undefined && {
          message: reservation.message,
        }),
        startsOn: reservation.startsOn,
        dayCount: reservation.dayCount,
        seats: reservation.seats,
        marketingConsent: reservation.marketingConsent,
      })
    ),
  })
);

export type OfficeReservationInput = typeof officeReservationSchema.Encoded;
export type OfficeReservationData = typeof officeReservationSchema.Type;

export const officeReservationDefaultValues: OfficeReservationInput = {
  startsOn: "",
  dayCount: 1,
  seats: 1,
  name: "",
  email: "",
  phone: "",
  message: "",
  marketingConsent: false,
};

export const getOfficeReservationOrder = (
  form: NormalizedOfficeReservationForm
): NormalizedOfficeReservationOrder =>
  normalizedOfficeReservationOrderSchema.make({
    kind: officeReservationKind,
    name: form.name,
    email: form.email,
    phone: form.phone,
    ...(form.message !== undefined && { message: form.message }),
    startsOn: form.startsOn,
    endsOn: decodePlainDate(getOfficeReservationEndsOn(form)),
    seats: form.seats,
  });

export const getOfficeReservationDefaultValues = (
  reservation: NormalizedOfficeReservationOrder
): OfficeReservationInput => ({
  startsOn: reservation.startsOn,
  dayCount: getOfficeReservationDayCount(reservation),
  seats: reservation.seats,
  name: reservation.name,
  email: reservation.email,
  phone: reservation.phone,
  ...(reservation.message !== undefined && { message: reservation.message }),
  marketingConsent: false,
});
