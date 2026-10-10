import {
  decodeStandardSchema,
  parseStandardSchema,
} from "@deskohub/standard-schema";
import { Match, Option, Schema } from "effect";
import {
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
  getMeetingRoomLastServiceDate,
  getMeetingRoomReservationDate,
} from "@/features/reservation/meeting-room-reservation-time";
import {
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
import { isPlainDateString } from "@/shared/utils/temporal";

const workspaceAvailabilityQueryBaseFields = {
  from: Schema.String,
  to: Schema.String,
};

export const coworkWorkspaceAvailabilityQuerySchema = Schema.Struct({
  kind: Schema.Literal(coworkReservationKind),
  ...workspaceAvailabilityQueryBaseFields,
  date: Schema.optional(Schema.String),
  entryTier: Schema.optional(Schema.Literals(workspaceCoworkCurrentTiers)),
  monitorOption: Schema.optional(
    Schema.Literals(workspaceProductMonitorOptions)
  ),
});

export const meetingRoomWorkspaceAvailabilityQuerySchema = Schema.Struct({
  kind: Schema.Literal(meetingRoomReservationKind),
  ...workspaceAvailabilityQueryBaseFields,
  startsAt: Schema.optional(reservationTimestampInputSchema),
  endsAt: Schema.optional(reservationTimestampInputSchema),
});

export const officeWorkspaceAvailabilityQuerySchema = Schema.Struct({
  kind: Schema.Literal(officeReservationKind),
  ...workspaceAvailabilityQueryBaseFields,
  startsAt: Schema.optional(reservationTimestampInputSchema),
  endsAt: Schema.optional(reservationTimestampInputSchema),
  seats: Schema.optional(officeSeatsSchema),
});

export const workspaceAvailabilityQuerySchema = Schema.Union([
  coworkWorkspaceAvailabilityQuerySchema,
  meetingRoomWorkspaceAvailabilityQuerySchema,
  officeWorkspaceAvailabilityQuerySchema,
]);

export type CoworkWorkspaceAvailabilityQuery =
  typeof coworkWorkspaceAvailabilityQuerySchema.Type;
export type MeetingRoomWorkspaceAvailabilityQuery =
  typeof meetingRoomWorkspaceAvailabilityQuerySchema.Type;
export type OfficeWorkspaceAvailabilityQuery =
  typeof officeWorkspaceAvailabilityQuerySchema.Type;

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

export type WorkspaceAvailabilityNotice =
  typeof workspaceAvailabilityNoticeSchema.Type;

export type WorkspaceAvailability =
  typeof workspaceAvailabilityResponseSchema.Type;

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

export const parseWorkspaceAvailabilityQuery = (
  searchParams: URLSearchParams,
  now = new Date()
): WorkspaceAvailabilityQuery => {
  const today = getCurrentWorkspaceDate(
    Temporal.Instant.fromEpochMilliseconds(now.getTime())
  );
  const from = getDateParam(searchParams, "from") ?? today.toString();
  const to =
    getDateParam(searchParams, "to") ?? today.add({ months: 6 }).toString();
  const reservationKind = getReservationKindParam(searchParams);

  return Match.value(reservationKind).pipe(
    Match.when("meeting-room", () => {
      const interval = getIntervalParam(searchParams);
      return {
        kind: meetingRoomReservationKind,
        from,
        to,
        ...(interval.startsAt && { startsAt: interval.startsAt }),
        ...(interval.endsAt && { endsAt: interval.endsAt }),
      };
    }),
    Match.when("cowork", () => {
      const date = getDateParam(searchParams, "date");
      const entryTier = getTierParam(searchParams.get("entryTier"));
      const monitorOption = getMonitorParam(searchParams.get("monitorOption"));
      return {
        kind: coworkReservationKind,
        from,
        to,
        ...(date && { date }),
        ...(entryTier && { entryTier }),
        ...(monitorOption && { monitorOption }),
      };
    }),
    Match.when("office", () => {
      const interval = getIntervalParam(searchParams);
      const seats = getOfficeSeatsParam(searchParams.get("seats"));
      return {
        kind: officeReservationKind,
        from,
        to,
        ...(interval.startsAt && { startsAt: interval.startsAt }),
        ...(interval.endsAt && { endsAt: interval.endsAt }),
        ...(seats && { seats }),
      };
    }),
    Match.exhaustive
  );
};
