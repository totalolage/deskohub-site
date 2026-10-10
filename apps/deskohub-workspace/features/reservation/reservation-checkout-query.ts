import { decodeStandardSchema } from "@deskohub/standard-schema";
import { Predicate, Record, Schema } from "effect";
import {
  getWorkspaceProductByTier,
  isWorkspaceCoworkCurrentProductTier,
  workspaceCoworkCurrentTiers,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import {
  type CoworkReservationInput,
  coworkReservationDefaultValues,
  type NormalizedCoworkReservationOrder,
} from "@/features/reservation/cowork-reservation";
import {
  type MeetingRoomReservationInput,
  meetingRoomReservationDefaultValues,
  meetingRoomStartDateTimeSchema,
} from "@/features/reservation/meeting-room-reservation";
import {
  getMeetingRoomReservationDuration,
  getMeetingRoomReservationDurationKey,
  meetingRoomReservationDurationKeySchema,
} from "@/features/reservation/meeting-room-reservation-duration";
import {
  getEarliestMeetingRoomStartDateTime,
  getMeetingRoomReservationInterval,
} from "@/features/reservation/meeting-room-reservation-time";
import {
  getOfficeReservationMaximumDayCount,
  getOfficeReservationMaximumEndsOn,
  type OfficeReservationInput,
  officeReservationDayCountSchema,
  officeReservationDefaultValues,
  officeSeatsSchema,
} from "@/features/reservation/office-reservation";
import {
  reservationCustomerEmailSchema,
  reservationCustomerNameSchema,
  reservationCustomerPhoneSchema,
} from "@/features/reservation/reservation-contact";
import { isTodayOrFutureWorkspaceDate } from "@/features/reservation/reservation-date";
import type {
  CustomerLastReservationForKind,
  ReservationCustomerMode,
} from "@/features/reservation/reservation-existing-customer";
import {
  type CoworkWorkspaceAvailabilityQuery,
  parseWorkspaceAvailabilityQuery,
} from "@/features/reservation/workspace-availability";
import { getSearchParam, type SupportedSearchParams } from "@/shared/utils";

const reservationCheckoutQueryFields = [
  "entryTier",
  "date",
  "coffee",
  "monitorOption",
  "name",
  "email",
  "phone",
] as const;

type ReservationCheckoutQueryField =
  (typeof reservationCheckoutQueryFields)[number];

type ReservationCheckoutQueryValues = Pick<
  CoworkReservationInput,
  ReservationCheckoutQueryField
>;
const queryBooleanSchema = Schema.toStandardSchemaV1(
  Schema.Literals(["true", "false"] as const)
);
const queryDateSchema = Schema.toStandardSchemaV1(
  Schema.String.check(
    Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/),
    Schema.makeFilter(isTodayOrFutureWorkspaceDate)
  )
);
const queryTierSchema = Schema.toStandardSchemaV1(
  Schema.Literals(workspaceCoworkCurrentTiers)
);
const queryMonitorOptionSchema = Schema.toStandardSchemaV1(
  Schema.Literals(workspaceProductMonitorOptions)
);
const queryOfficeDayCountSchema = Schema.toStandardSchemaV1(
  Schema.FiniteFromString.pipe(Schema.decodeTo(officeReservationDayCountSchema))
);
const queryOfficeSeatsSchema = Schema.toStandardSchemaV1(
  Schema.FiniteFromString.pipe(Schema.decodeTo(officeSeatsSchema))
);
const queryCustomerSchemas = {
  name: Schema.toStandardSchemaV1(reservationCustomerNameSchema),
  email: Schema.toStandardSchemaV1(reservationCustomerEmailSchema),
  phone: Schema.toStandardSchemaV1(reservationCustomerPhoneSchema),
};

const getTrimmedSearchParam = (
  searchParams: SupportedSearchParams,
  key: string
) => {
  const value = getSearchParam(searchParams, key)?.trim();
  return value || undefined;
};

const decodeReservationCheckoutCustomer = (
  searchParams: SupportedSearchParams
): Partial<
  Pick<ReservationCheckoutQueryValues, keyof typeof queryCustomerSchemas>
> =>
  Record.filter(
    Record.map(queryCustomerSchemas, (schema, key): string | undefined =>
      decodeStandardSchema(schema, getTrimmedSearchParam(searchParams, key))
    ),
    Predicate.isNotUndefined
  );

/**
 * Query parameter that tells a signed-in visit whether the link prefills the
 * standing customer (`account`) or the exact contact in the link
 * (`contact`).
 */
export const reservationCustomerQueryParam = "customer";

const queryCustomerModeSchema = Schema.toStandardSchemaV1(
  Schema.Literals(["account", "contact"] as const)
);

/**
 * The customer mode a link asks for. An explicit `customer` parameter wins;
 * otherwise, on forms whose links prefill the contact, any contact field
 * asks for that exact contact. A link without either leaves the choice to
 * the page.
 */
export const getReservationCustomerQueryMode = (
  searchParams: SupportedSearchParams,
  { prefillsContact = true }: { readonly prefillsContact?: boolean } = {}
): ReservationCustomerMode | undefined =>
  decodeStandardSchema(
    queryCustomerModeSchema,
    getTrimmedSearchParam(searchParams, reservationCustomerQueryParam)
  ) ??
  (prefillsContact &&
  Record.keys(queryCustomerSchemas).some(
    (key) => getTrimmedSearchParam(searchParams, key) !== undefined
  )
    ? "contact"
    : undefined);

const decodeReservationCheckoutQuery = (
  searchParams: SupportedSearchParams
): Partial<ReservationCheckoutQueryValues> => {
  const requestedTier =
    getTrimmedSearchParam(searchParams, "entryTier") ??
    getTrimmedSearchParam(searchParams, "tier");

  const entryTier = decodeStandardSchema(queryTierSchema, requestedTier);

  const date = decodeStandardSchema(
    queryDateSchema,
    getTrimmedSearchParam(searchParams, "date")
  );

  const coffee = decodeStandardSchema(
    queryBooleanSchema,
    getTrimmedSearchParam(searchParams, "coffee")
  );

  const monitorOption = decodeStandardSchema(
    queryMonitorOptionSchema,
    getTrimmedSearchParam(searchParams, "monitorOption")
  );

  return {
    ...(entryTier !== undefined && { entryTier }),
    ...(date !== undefined && { date }),
    ...(coffee !== undefined && { coffee: coffee === "true" }),
    ...(monitorOption !== undefined && { monitorOption }),
    ...decodeReservationCheckoutCustomer(searchParams),
  };
};

/**
 * Cowork form values from a link. The customer's last cowork reservation
 * fills the offer options the link leaves open; a link naming another tier
 * replaces the whole remembered offer.
 */
export const getReservationDefaultValuesFromSearchParams = (
  searchParams: SupportedSearchParams,
  lastReservation?: CustomerLastReservationForKind<"cowork">
): CoworkReservationInput => {
  const query = decodeReservationCheckoutQuery(searchParams);
  const values: CoworkReservationInput = {
    ...coworkReservationDefaultValues,
    ...(lastReservation &&
      (query.entryTier === undefined ||
        query.entryTier === lastReservation.entryTier) && {
        entryTier: lastReservation.entryTier,
        coffee: lastReservation.coffee,
        monitorOption: lastReservation.monitorOption,
      }),
    ...query,
    marketingConsent: false,
  };

  const product = getWorkspaceProductByTier(values.entryTier);

  return {
    ...values,
    ...(product.coffeeAddon === "included" && { coffee: true }),
    ...(product.workstationAddon === "unavailable" && {
      monitorOption: undefined,
    }),
  };
};

export const getReservationDefaultValuesFromPayState = (
  reservation: NormalizedCoworkReservationOrder
): CoworkReservationInput => {
  if (!isWorkspaceCoworkCurrentProductTier(reservation.entryTier)) {
    throw new Error(
      "Historical cowork tiers cannot be restored into the reservation form.",
      { cause: reservation.entryTier }
    );
  }

  return {
    entryTier: reservation.entryTier,
    date: reservation.date,
    coffee: reservation.coffee,
    name: reservation.name,
    email: reservation.email,
    phone: reservation.phone,
    billing: reservation.billing,
    ...(reservation.monitorOption !== undefined && {
      monitorOption: reservation.monitorOption,
    }),
    marketingConsent: false,
  };
};

export const getOfficeReservationDefaultValuesFromSearchParams = (
  searchParams: SupportedSearchParams,
  options: {
    readonly lastReservation?: CustomerLastReservationForKind<"office">;
    readonly seatCapacity: number;
    readonly startsOn: string;
  }
): OfficeReservationInput => {
  const maximumDayCount = getOfficeReservationMaximumDayCount({
    startsOn: options.startsOn,
    maximumEndsOn: getOfficeReservationMaximumEndsOn(
      Temporal.PlainDate.from(options.startsOn)
    ),
    unavailableDates: [],
  });
  const isAllowedDayCount = (dayCount: number | undefined) =>
    dayCount !== undefined && dayCount <= maximumDayCount;
  const isAllowedSeats = (seats: number | undefined) =>
    seats !== undefined && seats <= options.seatCapacity;
  const dayCount = [
    decodeStandardSchema(
      queryOfficeDayCountSchema,
      getTrimmedSearchParam(searchParams, "dayCount")
    ),
    options.lastReservation?.dayCount,
  ].find(isAllowedDayCount);
  const seats = [
    decodeStandardSchema(
      queryOfficeSeatsSchema,
      getTrimmedSearchParam(searchParams, "seats")
    ),
    options.lastReservation?.seats,
  ].find(isAllowedSeats);

  return {
    ...officeReservationDefaultValues,
    startsOn: options.startsOn,
    ...(dayCount !== undefined && { dayCount }),
    ...(seats !== undefined && { seats }),
  };
};

const queryMeetingRoomStartDateTimeSchema = Schema.toStandardSchemaV1(
  meetingRoomStartDateTimeSchema
);
const queryMeetingRoomDurationKeySchema = Schema.toStandardSchemaV1(
  meetingRoomReservationDurationKeySchema
);

export const getMeetingRoomReservationDefaultValuesFromSearchParams = (
  searchParams: SupportedSearchParams,
  now = Temporal.Now.instant(),
  lastReservation?: CustomerLastReservationForKind<"meeting-room">
): MeetingRoomReservationInput => {
  const durationKey = decodeStandardSchema(
    queryMeetingRoomDurationKeySchema,
    getTrimmedSearchParam(searchParams, "duration")
  );
  const duration = getMeetingRoomReservationDuration(
    durationKey ??
      lastReservation?.duration ??
      meetingRoomReservationDefaultValues.duration
  );

  const startDateTime = decodeStandardSchema(
    queryMeetingRoomStartDateTimeSchema,
    getTrimmedSearchParam(searchParams, "startDateTime")
  );
  const startInterval =
    startDateTime === undefined
      ? null
      : getMeetingRoomReservationInterval(startDateTime, duration);
  // Fresh query decoding rejects any start at or before now, even when the
  // interval end is still in the future; submission keeps its own end-based
  // rule inside the reservation schema.
  const startDateTimeOrEarliest =
    startDateTime !== undefined &&
    startInterval !== null &&
    Temporal.Instant.compare(startInterval.startsAt, now) >= 0
      ? startDateTime
      : getEarliestMeetingRoomStartDateTime(duration, now);

  return {
    ...meetingRoomReservationDefaultValues,
    ...decodeReservationCheckoutCustomer(searchParams),
    duration: getMeetingRoomReservationDurationKey(duration),
    startDateTime: startDateTimeOrEarliest,
    marketingConsent: false,
  };
};

export const getWorkspaceAvailabilityQueryFromReservationSearchParams = (
  searchParams: SupportedSearchParams
): CoworkWorkspaceAvailabilityQuery => {
  const defaultValues =
    getReservationDefaultValuesFromSearchParams(searchParams);
  const availabilitySearchParams = new URLSearchParams();

  if (defaultValues.date) {
    availabilitySearchParams.set("date", defaultValues.date);
  }
  if (defaultValues.entryTier) {
    availabilitySearchParams.set("entryTier", defaultValues.entryTier);
  }
  if (defaultValues.monitorOption) {
    availabilitySearchParams.set("monitorOption", defaultValues.monitorOption);
  }

  const query = parseWorkspaceAvailabilityQuery(availabilitySearchParams);

  if (query.kind !== "cowork") {
    throw new Error("Cowork checkout query produced a non-cowork query.", {
      cause: query,
    });
  }

  const { entryTier, ...rest } = query;

  return {
    ...rest,
    ...(entryTier !== undefined &&
      isWorkspaceCoworkCurrentProductTier(entryTier) && { entryTier }),
  };
};
