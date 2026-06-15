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

export type WorkspaceAvailabilityQuery = {
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

  return {
    from,
    to,
    ...(date && { date }),
    ...(entryTier && { entryTier }),
    ...(monitorOption && { monitorOption }),
  };
};
