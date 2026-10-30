import {
  decodeStandardSchema,
  parseStandardSchema,
} from "@deskohub/standard-schema";
import { Match, Option, Schema } from "effect";
import {
  getCoworkTierWorkstationAddon,
  isWorkspaceCoworkCurrentProductTier,
  isWorkspaceProductMonitorOption,
  type WorkspaceCoworkProductTier,
  workspaceCoworkCurrentTiers,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import {
  type WorkspaceCoworkAvailabilityTarget,
  workspaceCoworkProductIdentitySchema,
} from "@/features/reservation/cowork-reservation-product";
import type { WorkspaceMeetingRoomProductTarget } from "@/features/reservation/meeting-room-reservation";
import {
  getMeetingRoomReservationDuration,
  type MeetingRoomReservationDurationKey,
  meetingRoomReservationDurationKeySchema,
} from "@/features/reservation/meeting-room-reservation-duration";
import {
  findMeetingRoomReservationDuration,
  getMeetingRoomLastServiceDate,
  getMeetingRoomReservationDate,
  getMeetingRoomReservationInterval,
} from "@/features/reservation/meeting-room-reservation-time";
import {
  getOfficeReservationMaximumEndsOn,
  officeSeatsSchema,
  type WorkspaceOfficeProductTarget,
} from "@/features/reservation/office-reservation";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import {
  type ReservationInterval,
  reservationIntervalSchema,
  reservationTimestampInputSchema,
} from "@/features/reservation/reservation-interval";
import {
  coworkReservationKind,
  meetingRoomReservationKind,
  officeReservationKind,
  workspaceReservationKindSchema,
} from "@/features/reservation/reservation-kind";
import {
  instantStringSchema,
  isPlainDateString,
  localDateTimeSchema,
  plainDateStringSchema,
} from "@/shared/utils/temporal";

const workspaceAvailabilityQueryBaseFields = {
  from: Schema.String,
  to: Schema.String,
};

const coworkWorkspaceAvailabilityQuerySchema = Schema.Struct({
  kind: Schema.Literal(coworkReservationKind),
  ...workspaceAvailabilityQueryBaseFields,
  date: Schema.optional(Schema.String),
  entryTier: Schema.optional(Schema.Literals(workspaceCoworkCurrentTiers)),
  monitorOption: Schema.optional(
    Schema.Literals(workspaceProductMonitorOptions)
  ),
});

const meetingRoomWorkspaceAvailabilityQuerySchema = Schema.Struct({
  kind: Schema.Literal(meetingRoomReservationKind),
  ...workspaceAvailabilityQueryBaseFields,
  startsAt: Schema.optional(reservationTimestampInputSchema),
  endsAt: Schema.optional(reservationTimestampInputSchema),
});

const officeWorkspaceAvailabilityQuerySchema = Schema.Struct({
  kind: Schema.Literal(officeReservationKind),
  ...workspaceAvailabilityQueryBaseFields,
  startsAt: Schema.optional(reservationTimestampInputSchema),
  endsAt: Schema.optional(reservationTimestampInputSchema),
  seats: Schema.optional(officeSeatsSchema),
});

/**
 * The availability query mode that lists every free meeting-room start on one
 * date instead of checking one interval across a date range.
 */
const meetingRoomStartTimesMode = "start-times";

const meetingRoomStartTimesQuerySchema = Schema.Struct({
  kind: Schema.Literal(meetingRoomReservationKind),
  mode: Schema.Literal(meetingRoomStartTimesMode),
  date: plainDateStringSchema,
  duration: meetingRoomReservationDurationKeySchema,
});

type CoworkWorkspaceAvailabilityQuery =
  typeof coworkWorkspaceAvailabilityQuerySchema.Type;
export type MeetingRoomWorkspaceAvailabilityQuery =
  typeof meetingRoomWorkspaceAvailabilityQuerySchema.Type;
export type OfficeWorkspaceAvailabilityQuery =
  typeof officeWorkspaceAvailabilityQuerySchema.Type;
export type MeetingRoomStartTimesQuery =
  typeof meetingRoomStartTimesQuerySchema.Type;

// Internal availability computations also serve historical recovery paths,
// so the selection query keeps every cowork tier decodable even though the
// public query schema only accepts the current offers.
export type CoworkWorkspaceAvailabilitySelectionQuery = Omit<
  CoworkWorkspaceAvailabilityQuery,
  "entryTier"
> & { readonly entryTier?: WorkspaceCoworkProductTier };

export type WorkspaceAvailabilityQuery =
  | CoworkWorkspaceAvailabilitySelectionQuery
  | MeetingRoomWorkspaceAvailabilityQuery
  | OfficeWorkspaceAvailabilityQuery;

export type WorkspaceAvailabilityUnavailableTarget =
  | WorkspaceCoworkAvailabilityTarget
  | WorkspaceMeetingRoomProductTarget
  | WorkspaceOfficeProductTarget;

export const workspaceAvailabilityKeys = {
  availability: (query: WorkspaceAvailabilityQuery) =>
    ["workspace-availability", query] as const,
  meetingRoomStartTimes: (query: MeetingRoomStartTimesQuery | undefined) =>
    ["workspace-availability", "meeting-room-start-times", query] as const,
};

const workspaceAvailabilityNoticeSchema = Schema.Struct({
  date: Schema.String,
  startsAt: Schema.String,
  endsAt: Schema.String,
  summary: Schema.optional(Schema.String),
});

const workspaceAvailabilityResponseSchema = Schema.Struct({
  date: Schema.optional(Schema.String),
  from: Schema.String,
  to: Schema.String,
  unavailableDates: Schema.Array(Schema.String),
  reservedDeskWorkstationRequiredDates: Schema.Array(Schema.String),
  unavailableCoworkTiers: Schema.Array(
    workspaceCoworkProductIdentitySchema.fields.tier
  ),
  meetingRoomUnavailable: Schema.Boolean,
  officeUnavailable: Schema.Boolean,
  unavailableMonitorOptions: Schema.Array(
    Schema.Literals(workspaceProductMonitorOptions)
  ),
  notices: Schema.Array(workspaceAvailabilityNoticeSchema),
});

const meetingRoomStartTimesResponseSchema = Schema.Struct({
  date: plainDateStringSchema,
  duration: meetingRoomReservationDurationKeySchema,
  /** Free starts in chronological order, each with the interval it books. */
  startTimes: Schema.Array(
    Schema.Struct({
      startDateTime: localDateTimeSchema,
      startsAt: instantStringSchema,
      endsAt: instantStringSchema,
      /**
       * Whether a meeting room is also free for the setup time before the
       * start, so the customer may come early to set up.
       */
      earlySetupAvailable: Schema.Boolean,
    })
  ),
});

/** Every free meeting-room start on one Prague date for one duration. */
export type MeetingRoomStartTimes =
  typeof meetingRoomStartTimesResponseSchema.Type;

export type WorkspaceAvailabilityNotice =
  typeof workspaceAvailabilityNoticeSchema.Type;

export type WorkspaceAvailability =
  typeof workspaceAvailabilityResponseSchema.Type;

/** Availability the server loaded for a query before the page rendered. */
export type PreloadedWorkspaceAvailability = {
  readonly availability: WorkspaceAvailability;
  /** When the server loaded it, in epoch milliseconds. */
  readonly loadedAt: number;
  readonly query: WorkspaceAvailabilityQuery;
};

/**
 * The calendar range availability is queried for by default: six months from
 * the workspace's current date.
 */
export const getWorkspaceAvailabilityRange = (today: string) => ({
  from: today,
  to: Temporal.PlainDate.from(today).add({ months: 6 }).toString(),
});

type CoworkAvailabilityQueries = {
  /** The selected tier's calendar range. */
  readonly range?: CoworkWorkspaceAvailabilityQuery;
  /** The selected offer on the selected day alone. */
  readonly selection?: CoworkWorkspaceAvailabilityQuery;
  /** Whether a Reserved Desk needs a workstation on the selected day. */
  readonly workstationRequirement?: CoworkWorkspaceAvailabilityQuery;
};

/**
 * The availability queries a cowork reservation form reads for its selection.
 * The page preloads the same queries, so both sides must build them here from
 * the same workspace date.
 */
export const getCoworkAvailabilityQueries = ({
  date,
  entryTier,
  monitorOption,
  today,
}: {
  readonly date?: string;
  readonly entryTier?: string;
  readonly monitorOption?: string;
  readonly today: string;
}): CoworkAvailabilityQueries => {
  if (!isWorkspaceCoworkCurrentProductTier(entryTier)) return {};

  const range: CoworkWorkspaceAvailabilityQuery = {
    kind: coworkReservationKind,
    ...getWorkspaceAvailabilityRange(today),
    entryTier,
  };
  if (!date) return { range };

  // Selection queries only read the selected date's result, so they ask for
  // that day alone instead of the whole calendar range.
  const selectedDate: CoworkWorkspaceAvailabilityQuery = {
    kind: coworkReservationKind,
    from: date,
    to: date,
    entryTier,
    date,
  };

  return {
    range,
    selection: {
      ...selectedDate,
      ...(getCoworkTierWorkstationAddon(entryTier) === "optional" &&
        isWorkspaceProductMonitorOption(monitorOption) && { monitorOption }),
    },
    ...(entryTier === "reserved-desk" && {
      workstationRequirement: selectedDate,
    }),
  };
};

/** The office availability query spanning the office booking horizon. */
export const getOfficeAvailabilityQuery = (
  today: string
): OfficeWorkspaceAvailabilityQuery => ({
  kind: officeReservationKind,
  from: today,
  to: getOfficeReservationMaximumEndsOn(
    Temporal.PlainDate.from(today)
  ).toString(),
});

/**
 * Whether a cowork offer can be booked on its date, by the same rules the
 * reservation form applies: a Reserved Desk stays bookable on dates that only
 * require a workstation, which the form adds itself.
 */
export const isCoworkOfferAvailable = (
  availability: Pick<
    WorkspaceAvailability,
    | "reservedDeskWorkstationRequiredDates"
    | "unavailableCoworkTiers"
    | "unavailableDates"
    | "unavailableMonitorOptions"
  >,
  offer: Pick<
    CoworkWorkspaceAvailabilitySelectionQuery,
    "entryTier" | "monitorOption"
  > & { readonly date: string }
) =>
  !(
    (offer.entryTier !== undefined &&
      availability.unavailableCoworkTiers.includes(offer.entryTier)) ||
    (offer.monitorOption !== undefined &&
      availability.unavailableMonitorOptions.includes(offer.monitorOption)) ||
    (availability.unavailableDates.includes(offer.date) &&
      !(
        offer.entryTier === "reserved-desk" &&
        availability.reservedDeskWorkstationRequiredDates.includes(offer.date)
      ))
  );

/** The availability query for one meeting-room reservation interval. */
export const getMeetingRoomAvailabilityQuery = (
  interval: ReservationInterval
): MeetingRoomWorkspaceAvailabilityQuery => ({
  kind: "meeting-room",
  from: getMeetingRoomReservationDate(interval),
  to: getMeetingRoomLastServiceDate(interval),
  startsAt: interval.startsAt,
  endsAt: interval.endsAt,
});

/**
 * The availability query for a selected meeting-room start and duration,
 * shared by the page preload and the form so both use the same query key.
 */
export const getMeetingRoomSelectionAvailabilityQuery = ({
  duration,
  startDateTime,
}: {
  readonly duration: MeetingRoomReservationDurationKey;
  readonly startDateTime: string;
}): MeetingRoomWorkspaceAvailabilityQuery | undefined => {
  const interval = getMeetingRoomReservationInterval(
    startDateTime,
    getMeetingRoomReservationDuration(duration)
  );

  return interval ? getMeetingRoomAvailabilityQuery(interval) : undefined;
};

const decodeLocalDateTime = Schema.decodeUnknownOption(localDateTimeSchema);

/**
 * The start-times query for the date of a selected meeting-room start, or none
 * before a date is selected.
 */
export const getMeetingRoomStartTimesQuery = ({
  duration,
  startDateTime,
}: {
  readonly duration: MeetingRoomReservationDurationKey;
  readonly startDateTime: string;
}): MeetingRoomStartTimesQuery | undefined =>
  decodeLocalDateTime(startDateTime).pipe(
    Option.map(
      (selectedStart): MeetingRoomStartTimesQuery => ({
        kind: meetingRoomReservationKind,
        mode: meetingRoomStartTimesMode,
        date: plainDateStringSchema.make(
          Temporal.PlainDateTime.from(selectedStart).toPlainDate().toString()
        ),
        duration,
      })
    ),
    Option.getOrUndefined
  );

/**
 * The listed free start that books from `startsAt`, which says whether its
 * setup time is free too, or none when that start isn't free.
 */
export const findMeetingRoomStartTime = (
  { startTimes }: MeetingRoomStartTimes,
  startsAt: Temporal.Instant
) =>
  startTimes.find(
    (startTime) =>
      Temporal.Instant.compare(
        Temporal.Instant.from(startTime.startsAt),
        startsAt
      ) === 0
  );

/**
 * Whether the meeting room is free for the interval its availability was
 * queried for.
 */
export const isMeetingRoomAvailable = (
  availability: Pick<
    WorkspaceAvailability,
    "meetingRoomUnavailable" | "unavailableDates"
  >
) =>
  availability.unavailableDates.length === 0 &&
  !availability.meetingRoomUnavailable;

const workspaceAvailabilitySchema = Schema.toStandardSchemaV1(
  workspaceAvailabilityResponseSchema
);

export const parseWorkspaceAvailabilityResponse = <T>(
  value: T
): WorkspaceAvailability =>
  parseStandardSchema(
    workspaceAvailabilitySchema,
    value,
    "Invalid workspace availability response"
  );

const meetingRoomStartTimesStandardSchema = Schema.toStandardSchemaV1(
  meetingRoomStartTimesResponseSchema
);

export const parseMeetingRoomStartTimesResponse = <T>(
  value: T
): MeetingRoomStartTimes =>
  parseStandardSchema(
    meetingRoomStartTimesStandardSchema,
    value,
    "Invalid meeting-room start times response"
  );

/** Whether an availability request asks for meeting-room start times. */
export const isMeetingRoomStartTimesRequest = (searchParams: URLSearchParams) =>
  searchParams.get("mode")?.trim() === meetingRoomStartTimesMode;

const decodeMeetingRoomStartTimesQuery = Schema.decodeUnknownOption(
  meetingRoomStartTimesQuerySchema
);

/**
 * The start-times query a request names, or none when its kind, date, or
 * duration is missing or invalid. Unlike date-range availability it has no
 * defaults, so an invalid parameter never lists another day's start times.
 */
export const parseMeetingRoomStartTimesQuery = (
  searchParams: URLSearchParams
) =>
  decodeMeetingRoomStartTimesQuery({
    kind: searchParams.get("kind")?.trim(),
    mode: searchParams.get("mode")?.trim(),
    date: searchParams.get("date")?.trim(),
    duration: searchParams.get("duration")?.trim(),
  });

const isCanonicalPlainDate = Schema.is(
  Schema.String.check(isPlainDateString())
);
const workspaceAvailabilityIntervalSchema = Schema.toStandardSchemaV1(
  reservationIntervalSchema
);

const getDateParam = (searchParams: URLSearchParams, key: string) => {
  const value = searchParams.get(key)?.trim();
  if (!value || !isCanonicalPlainDate(value)) return undefined;
  return value;
};

const getTierParam = (value: string | null) => {
  const normalized = value?.trim();
  return isWorkspaceCoworkCurrentProductTier(normalized)
    ? normalized
    : undefined;
};

const decodeReservationKindParam = Schema.decodeUnknownOption(
  workspaceReservationKindSchema
);

const getReservationKindParam = (searchParams: URLSearchParams) =>
  Option.getOrElse(
    decodeReservationKindParam(searchParams.get("kind")?.trim()),
    () => coworkReservationKind
  );

const decodeOfficeSeatsParam = Schema.decodeUnknownOption(
  Schema.NumberFromString.pipe(Schema.decodeTo(officeSeatsSchema))
);

const getOfficeSeatsParam = (value: string | null) =>
  Option.getOrUndefined(decodeOfficeSeatsParam(value));

const getMonitorParam = (value: string | null) => {
  const normalized = value?.trim();
  return isWorkspaceProductMonitorOption(normalized) ? normalized : undefined;
};

const getIntervalParam = (
  searchParams: URLSearchParams
): Partial<ReservationInterval> => {
  const startsAt = searchParams.get("startsAt")?.trim() || undefined;
  const endsAt = searchParams.get("endsAt")?.trim() || undefined;

  if (!startsAt && !endsAt) return {};

  const parsed = decodeStandardSchema(workspaceAvailabilityIntervalSchema, {
    startsAt,
    endsAt,
  });

  return parsed ?? {};
};

const hasIntervalParam = (searchParams: URLSearchParams) =>
  Boolean(
    searchParams.get("startsAt")?.trim() || searchParams.get("endsAt")?.trim()
  );

const isMeetingRoomBookingInterval = (
  interval: Partial<ReservationInterval>
): interval is ReservationInterval =>
  interval.startsAt !== undefined &&
  interval.endsAt !== undefined &&
  findMeetingRoomReservationDuration({
    startsAt: Temporal.Instant.from(interval.startsAt),
    endsAt: Temporal.Instant.from(interval.endsAt),
  }) !== undefined;

/**
 * A meeting-room query names a date range, or one interval a meeting-room
 * duration books. An interval check covers the dates the interval touches
 * whatever range the request names, so every check for a start date reads the
 * shared inventory snapshot that date's start-times list reads. Any other
 * interval is rejected rather than widening that snapshot.
 */
const parseMeetingRoomAvailabilityQuery = (
  searchParams: URLSearchParams,
  range: Pick<MeetingRoomWorkspaceAvailabilityQuery, "from" | "to">
): Option.Option<MeetingRoomWorkspaceAvailabilityQuery> => {
  if (!hasIntervalParam(searchParams)) {
    return Option.some({ kind: meetingRoomReservationKind, ...range });
  }

  const interval = getIntervalParam(searchParams);
  return isMeetingRoomBookingInterval(interval)
    ? Option.some(getMeetingRoomAvailabilityQuery(interval))
    : Option.none();
};

/**
 * The availability query a request names, or none for a meeting-room interval
 * no meeting-room duration books.
 */
export const parseWorkspaceAvailabilityQuery = (
  searchParams: URLSearchParams,
  now = new Date()
): Option.Option<WorkspaceAvailabilityQuery> => {
  const range = getWorkspaceAvailabilityRange(
    getCurrentWorkspaceDate(
      Temporal.Instant.fromEpochMilliseconds(now.getTime())
    ).toString()
  );
  const from = getDateParam(searchParams, "from") ?? range.from;
  const to = getDateParam(searchParams, "to") ?? range.to;
  const reservationKind = getReservationKindParam(searchParams);

  return Match.value(reservationKind).pipe(
    Match.when("meeting-room", () =>
      parseMeetingRoomAvailabilityQuery(searchParams, { from, to })
    ),
    Match.when("cowork", () => {
      const date = getDateParam(searchParams, "date");
      const entryTier = getTierParam(searchParams.get("entryTier"));
      const monitorOption = getMonitorParam(searchParams.get("monitorOption"));
      return Option.some({
        kind: coworkReservationKind,
        from,
        to,
        ...(date && { date }),
        ...(entryTier && { entryTier }),
        ...(monitorOption && { monitorOption }),
      });
    }),
    Match.when("office", () => {
      const interval = getIntervalParam(searchParams);
      const seats = getOfficeSeatsParam(searchParams.get("seats"));
      return Option.some({
        kind: officeReservationKind,
        from,
        to,
        ...(interval.startsAt && { startsAt: interval.startsAt }),
        ...(interval.endsAt && { endsAt: interval.endsAt }),
        ...(seats && { seats }),
      });
    }),
    Match.exhaustive
  );
};
