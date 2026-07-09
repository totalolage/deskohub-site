import {
  decodeStandardSchema,
  parseStandardSchema,
} from "@deskohub/standard-schema";
import { Schema } from "effect";
import {
  isWorkspaceCoworkProductTier,
  isWorkspaceProductMonitorOption,
  type WorkspaceCoworkProductTier,
  type WorkspaceProductMonitorOption,
  workspaceCoworkTiers,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import { reservationTimeZone } from "@/features/reservation/reservation-date";
import {
  defaultReservationInterval,
  getReservationIntervalValidationIssue,
  type ReservationInterval,
  reservationIntervalFieldSchemas,
  unsafeNormalizeReservationInterval,
} from "@/features/reservation/schemas/reservation-interval";

export type WorkspaceAvailabilityQuery = Partial<ReservationInterval> & {
  readonly _tag: "cowork" | "meeting-room";
  readonly date?: string;
  readonly from: string;
  readonly to: string;
  readonly entryTier?: WorkspaceCoworkProductTier;
  readonly monitorOption?: WorkspaceProductMonitorOption;
};

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

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
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
  if (!value || !datePattern.test(value)) return undefined;
  return value;
};

const getTierParam = (value: string | null) => {
  const normalized = value?.trim();
  return isWorkspaceCoworkProductTier(normalized) ? normalized : undefined;
};

const getReservationKindParam = (searchParams: URLSearchParams) => {
  const kind = searchParams.get("kind")?.trim();
  if (kind === "meeting-room") return "meeting-room";
  if (kind === "cowork") return "cowork";
  return searchParams.get("entryTier")?.trim() === "meeting-room"
    ? "meeting-room"
    : "cowork";
};

const getMonitorParam = (value: string | null) => {
  const normalized = value?.trim();
  return isWorkspaceProductMonitorOption(normalized) ? normalized : undefined;
};

const getIntervalParam = (
  searchParams: URLSearchParams,
  date?: string
): Partial<ReservationInterval> => {
  const defaultInterval = () =>
    date
      ? unsafeNormalizeReservationInterval({
          date,
          ...defaultReservationInterval,
        })
      : {};
  const startsAt = searchParams.get("startsAt")?.trim() || undefined;
  const endsAt = searchParams.get("endsAt")?.trim() || undefined;

  if (!startsAt && !endsAt) return defaultInterval();

  const parsed = decodeStandardSchema(workspaceAvailabilityIntervalSchema, {
    startsAt,
    endsAt,
  });

  if (!parsed) return defaultInterval();
  const interval = { date, ...parsed };
  if (getReservationIntervalValidationIssue(interval)) {
    return defaultInterval();
  }

  return unsafeNormalizeReservationInterval(interval);
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
  const interval = getIntervalParam(searchParams, date);

  return {
    _tag: reservationKind,
    from,
    to,
    ...(interval.startsAt && { startsAt: interval.startsAt }),
    ...(interval.endsAt && { endsAt: interval.endsAt }),
    ...(date && { date }),
    ...(entryTier && { entryTier }),
    ...(reservationKind === "cowork" && monitorOption && { monitorOption }),
  };
};
