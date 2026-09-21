import { decodeStandardSchema } from "@deskohub/standard-schema";
import { Schema } from "effect";
import {
  getWorkspaceProductByTier,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import {
  type CoworkReservationInput,
  coworkReservationDefaultValues,
  type NormalizedCoworkReservationOrder,
} from "@/features/reservation/cowork-reservation";
import { workspaceCoworkProductIdentitySchema } from "@/features/reservation/cowork-reservation-product";
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
  reservationCustomerMessageSchema,
  reservationCustomerNameSchema,
  reservationCustomerPhoneSchema,
} from "@/features/reservation/reservation-contact";
import { isTodayOrFutureWorkspaceDate } from "@/features/reservation/reservation-date";
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
  "message",
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
  workspaceCoworkProductIdentitySchema.fields.tier
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
const queryNameSchema = Schema.toStandardSchemaV1(
  reservationCustomerNameSchema
);
const queryEmailSchema = Schema.toStandardSchemaV1(
  reservationCustomerEmailSchema
);
const queryPhoneSchema = Schema.toStandardSchemaV1(
  reservationCustomerPhoneSchema
);
const queryMessageSchema = Schema.toStandardSchemaV1(
  reservationCustomerMessageSchema
);

const getTrimmedSearchParam = (
  searchParams: SupportedSearchParams,
  key: string
) => {
  const value = getSearchParam(searchParams, key)?.trim();
  return value || undefined;
};

const decodeReservationCheckoutCustomer = (
  searchParams: SupportedSearchParams
) => {
  const name = decodeStandardSchema(
    queryNameSchema,
    getTrimmedSearchParam(searchParams, "name")
  );

  const email = decodeStandardSchema(
    queryEmailSchema,
    getTrimmedSearchParam(searchParams, "email")
  );

  const phone = decodeStandardSchema(
    queryPhoneSchema,
    getTrimmedSearchParam(searchParams, "phone")
  );

  const message = decodeStandardSchema(
    queryMessageSchema,
    getTrimmedSearchParam(searchParams, "message")
  );

  return {
    ...(name !== undefined && { name }),
    ...(email !== undefined && { email }),
    ...(phone !== undefined && { phone }),
    ...(message !== undefined && { message }),
  };
};

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

export const getReservationDefaultValuesFromSearchParams = (
  searchParams: SupportedSearchParams
): CoworkReservationInput => {
  const values: CoworkReservationInput = {
    ...coworkReservationDefaultValues,
    ...decodeReservationCheckoutQuery(searchParams),
    marketingConsent: false,
  };

  const product = getWorkspaceProductByTier(values.entryTier);

  return {
    ...values,
    ...(product.requiresCoffee && { coffee: true }),
    ...(!product.requiresMonitorOption && { monitorOption: undefined }),
  };
};

export const getReservationDefaultValuesFromPayState = (
  reservation: NormalizedCoworkReservationOrder
): CoworkReservationInput => ({
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
  ...(reservation.message !== undefined && { message: reservation.message }),
  marketingConsent: false,
});

export const getOfficeReservationDefaultValuesFromSearchParams = (
  searchParams: SupportedSearchParams,
  options: {
    readonly seatCapacity: number;
    readonly startsOn: string;
  }
): OfficeReservationInput => {
  const dayCount = decodeStandardSchema(
    queryOfficeDayCountSchema,
    getTrimmedSearchParam(searchParams, "dayCount")
  );
  const seats = decodeStandardSchema(
    queryOfficeSeatsSchema,
    getTrimmedSearchParam(searchParams, "seats")
  );
  const maximumDayCount = getOfficeReservationMaximumDayCount({
    startsOn: options.startsOn,
    maximumEndsOn: getOfficeReservationMaximumEndsOn(
      Temporal.PlainDate.from(options.startsOn)
    ),
    unavailableDates: [],
  });

  return {
    ...officeReservationDefaultValues,
    startsOn: options.startsOn,
    ...(dayCount !== undefined && dayCount <= maximumDayCount && { dayCount }),
    ...(seats !== undefined && seats <= options.seatCapacity && { seats }),
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
  now = Temporal.Now.instant()
): MeetingRoomReservationInput => {
  const durationKey = decodeStandardSchema(
    queryMeetingRoomDurationKeySchema,
    getTrimmedSearchParam(searchParams, "duration")
  );
  const duration = getMeetingRoomReservationDuration(
    durationKey ?? meetingRoomReservationDefaultValues.duration
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

  return query;
};
