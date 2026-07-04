import { parseStandardSchema } from "@deskohub/standard-schema";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { z } from "zod/v4";
import {
  isWorkspaceProductMonitorOption,
  isWorkspaceProductTier,
  type WorkspaceProductMonitorOption,
  type WorkspaceProductTier,
  workspaceProductMonitorOptions,
  workspaceProductTiers,
} from "@/features/checkout/product-catalog";
import {
  defaultReservationInterval,
  getReservationIntervalValidationIssue,
  type ReservationInterval,
  reservationIntervalFieldSchemas,
  unsafeNormalizeReservationInterval,
} from "@/features/reservation/schemas/reservation-interval";

export type WorkspaceAvailabilityQuery = Partial<ReservationInterval> & {
  readonly date?: string;
  readonly from: string;
  readonly to: string;
  readonly entryTier?: WorkspaceProductTier;
  readonly monitorOption?: WorkspaceProductMonitorOption;
};

export type WorkspaceAvailabilityNotice = {
  readonly date: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly summary?: string;
};

export type WorkspaceAvailability = {
  readonly date?: string;
  readonly from: string;
  readonly to: string;
  readonly unavailableDates: readonly string[];
  readonly unavailableTiers: readonly WorkspaceProductTier[];
  readonly unavailableMonitorOptions: readonly WorkspaceProductMonitorOption[];
  readonly notices: readonly WorkspaceAvailabilityNotice[];
};

export const workspaceAvailabilityKeys = {
  availability: (query: WorkspaceAvailabilityQuery) =>
    ["workspace-availability", query] as const,
};

const workspaceAvailabilityNoticeSchema = z.object({
  date: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  summary: z.string().optional(),
});

const workspaceAvailabilityResponseSchema = z.object({
  date: z.string().optional(),
  from: z.string(),
  to: z.string(),
  unavailableDates: z.array(z.string()),
  unavailableTiers: z.array(z.enum(workspaceProductTiers)),
  unavailableMonitorOptions: z.array(z.enum(workspaceProductMonitorOptions)),
  notices: z.array(workspaceAvailabilityNoticeSchema),
});

const workspaceAvailabilitySchema: StandardSchemaV1<
  unknown,
  WorkspaceAvailability
> = workspaceAvailabilityResponseSchema;

export const parseWorkspaceAvailabilityResponse = (
  value: unknown
): WorkspaceAvailability =>
  parseStandardSchema(
    workspaceAvailabilitySchema,
    value,
    "Invalid workspace availability response"
  );

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const workspaceAvailabilityIntervalSchema = z.object(
  reservationIntervalFieldSchemas
);

const pragueDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Prague",
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
  return isWorkspaceProductTier(normalized) ? normalized : undefined;
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

  const parsed = workspaceAvailabilityIntervalSchema.safeParse({
    startsAt,
    endsAt,
  });

  if (!parsed.success) return defaultInterval();
  const interval = { date, ...parsed.data };
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
  const entryTier = getTierParam(searchParams.get("entryTier"));
  const monitorOption = getMonitorParam(searchParams.get("monitorOption"));
  const interval = getIntervalParam(searchParams, date);

  return {
    from,
    to,
    ...(interval.startsAt && { startsAt: interval.startsAt }),
    ...(interval.endsAt && { endsAt: interval.endsAt }),
    ...(date && { date }),
    ...(entryTier && { entryTier }),
    ...(monitorOption && { monitorOption }),
  };
};
