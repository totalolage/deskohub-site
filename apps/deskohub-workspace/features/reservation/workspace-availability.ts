import {
  decodeStandardSchema,
  parseStandardSchema,
} from "@deskohub/standard-schema";
import { Match, Schema } from "effect";
import {
  isWorkspaceCoworkProductTier,
  isWorkspaceProductMonitorOption,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import { workspaceCoworkProductIdentitySchema } from "@/features/reservation/cowork-reservation-product";
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
  entryTier: Schema.optional(workspaceCoworkProductIdentitySchema.fields.tier),
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
  guestCount: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
  ),
});

export const workspaceAvailabilityQuerySchema = Schema.Union([
  coworkWorkspaceAvailabilityQuerySchema,
  meetingRoomWorkspaceAvailabilityQuerySchema,
  officeWorkspaceAvailabilityQuerySchema,
]);

export type WorkspaceAvailabilityQuery =
  typeof workspaceAvailabilityQuerySchema.Type;
export type CoworkWorkspaceAvailabilityQuery =
  typeof coworkWorkspaceAvailabilityQuerySchema.Type;
export type MeetingRoomWorkspaceAvailabilityQuery =
  typeof meetingRoomWorkspaceAvailabilityQuerySchema.Type;
export type OfficeWorkspaceAvailabilityQuery =
  typeof officeWorkspaceAvailabilityQuerySchema.Type;

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

const workspaceAvailabilitySchema = Schema.toStandardSchemaV1(
  workspaceAvailabilityResponseSchema
);

export const parseWorkspaceAvailabilityResponse = (
  value: unknown
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
  return isWorkspaceCoworkProductTier(normalized) ? normalized : undefined;
};

const getReservationKindParam = (searchParams: URLSearchParams) => {
  const kind = searchParams.get("kind")?.trim();
  if (kind === "meeting-room") return "meeting-room";
  if (kind === "office") return "office";
  return "cowork";
};

const getGuestCountParam = (value: string | null) => {
  const guestCount = Number(value);
  return Number.isSafeInteger(guestCount) && guestCount >= 1
    ? guestCount
    : undefined;
};

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
  const date = getDateParam(searchParams, "date");
  const reservationKind = getReservationKindParam(searchParams);
  const entryTier =
    reservationKind === "cowork" && getTierParam(searchParams.get("entryTier"));
  const monitorOption = getMonitorParam(searchParams.get("monitorOption"));
  const interval =
    reservationKind === "meeting-room" || reservationKind === "office"
      ? getIntervalParam(searchParams)
      : {};
  const guestCount =
    reservationKind === "office"
      ? getGuestCountParam(searchParams.get("guestCount"))
      : undefined;

  return Match.value(reservationKind).pipe(
    Match.when("meeting-room", () => ({
      kind: meetingRoomReservationKind,
      from,
      to,
      ...(interval.startsAt && { startsAt: interval.startsAt }),
      ...(interval.endsAt && { endsAt: interval.endsAt }),
    })),
    Match.when("cowork", () => ({
      kind: coworkReservationKind,
      from,
      to,
      ...(date && { date }),
      ...(entryTier && { entryTier }),
      ...(monitorOption && { monitorOption }),
    })),
    Match.when("office", () => ({
      kind: officeReservationKind,
      from,
      to,
      ...(interval.startsAt && { startsAt: interval.startsAt }),
      ...(interval.endsAt && { endsAt: interval.endsAt }),
      ...(guestCount && { guestCount }),
    })),
    Match.exhaustive
  );
};
