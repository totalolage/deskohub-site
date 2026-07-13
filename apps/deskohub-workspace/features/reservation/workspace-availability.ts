import {
  decodeStandardSchema,
  parseStandardSchema,
} from "@deskohub/standard-schema";
import { Match, Schema } from "effect";
import {
  isWorkspaceCoworkProductTier,
  isWorkspaceProductMonitorOption,
  workspaceCoworkTiers,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import { reservationTimeZone } from "@/features/reservation/reservation-date";
import {
  getReservationIntervalNormalization,
  type ReservationInterval,
  reservationIntervalFieldSchemas,
} from "@/features/reservation/reservation-interval";
import { isPlainDateString } from "@/shared/utils/temporal";

const workspaceAvailabilityQueryBaseEffectFields = {
  from: Schema.String,
  to: Schema.String,
};

export const workspaceAvailabilityQueryEffectSchema = Schema.Union([
  Schema.TaggedStruct("cowork", {
    ...workspaceAvailabilityQueryBaseEffectFields,
    date: Schema.optional(Schema.String),
    entryTier: Schema.optional(Schema.Literals(workspaceCoworkTiers)),
    monitorOption: Schema.optional(
      Schema.Literals(workspaceProductMonitorOptions)
    ),
  }),
  Schema.TaggedStruct("meeting-room", {
    ...workspaceAvailabilityQueryBaseEffectFields,
    startsAt: Schema.optional(reservationIntervalFieldSchemas.startsAt),
    endsAt: Schema.optional(reservationIntervalFieldSchemas.endsAt),
  }),
]);

export type WorkspaceAvailabilityQuery =
  typeof workspaceAvailabilityQueryEffectSchema.Type;

export const workspaceAvailabilityKeys = {
  availability: (query: WorkspaceAvailabilityQuery) =>
    ["workspace-availability", query] as const,
};

const workspaceAvailabilityNoticeEffectSchema = Schema.Struct({
  date: Schema.String,
  startsAt: Schema.String,
  endsAt: Schema.String,
  summary: Schema.optional(Schema.String),
});

const workspaceAvailabilityResponseEffectSchema = Schema.Struct({
  date: Schema.optional(Schema.String),
  from: Schema.String,
  to: Schema.String,
  unavailableDates: Schema.Array(Schema.String),
  unavailableCoworkTiers: Schema.Array(Schema.Literals(workspaceCoworkTiers)),
  meetingRoomUnavailable: Schema.Boolean,
  unavailableMonitorOptions: Schema.Array(
    Schema.Literals(workspaceProductMonitorOptions)
  ),
  notices: Schema.Array(workspaceAvailabilityNoticeEffectSchema),
});

export type WorkspaceAvailabilityNotice =
  typeof workspaceAvailabilityNoticeEffectSchema.Type;

export type WorkspaceAvailability =
  typeof workspaceAvailabilityResponseEffectSchema.Type;

const workspaceAvailabilitySchema = Schema.toStandardSchemaV1(
  workspaceAvailabilityResponseEffectSchema
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
  Schema.Struct(reservationIntervalFieldSchemas)
);

const pragueDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: reservationTimeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const getCurrentPragueDate = (date: Date) => {
  const dateParts = Object.fromEntries(
    pragueDateFormatter
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );

  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
};

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
  return "cowork";
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

  if (!parsed) return {};
  const normalization = getReservationIntervalNormalization(parsed);
  return normalization._tag === "Success" ? normalization.interval : {};
};

export const parseWorkspaceAvailabilityQuery = (
  searchParams: URLSearchParams,
  now = new Date()
): WorkspaceAvailabilityQuery => {
  const today = getCurrentPragueDate(now);
  const from = getDateParam(searchParams, "from") ?? today;
  const to =
    getDateParam(searchParams, "to") ??
    Temporal.PlainDate.from(today).add({ months: 6 }).toString();
  const date = getDateParam(searchParams, "date");
  const reservationKind = getReservationKindParam(searchParams);
  const entryTier =
    reservationKind === "cowork" && getTierParam(searchParams.get("entryTier"));
  const monitorOption = getMonitorParam(searchParams.get("monitorOption"));
  const interval =
    reservationKind === "meeting-room" ? getIntervalParam(searchParams) : {};

  return Match.value(reservationKind).pipe(
    Match.when("meeting-room", () => ({
      _tag: "meeting-room" as const,
      from,
      to,
      ...(interval.startsAt && { startsAt: interval.startsAt }),
      ...(interval.endsAt && { endsAt: interval.endsAt }),
    })),
    Match.when("cowork", () => ({
      _tag: "cowork" as const,
      from,
      to,
      ...(date && { date }),
      ...(entryTier && { entryTier }),
      ...(monitorOption && { monitorOption }),
    })),
    Match.exhaustive
  );
};
