import { getWorkspaceProductByTier } from "@/features/checkout/product-catalog";
import { moneyMajorAmount } from "@/shared/money/money";
import { escapeRegExp } from "@/shared/utils/escape-regexp";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import type { AgentEvalBrowserObservations } from "./observations";
import {
  type AgentEvalTaskParameters,
  agentEvalMeetingRoomHours,
  agentEvalOfficeDays,
  agentEvalOfficeSeats,
} from "./tasks";

/**
 * One reservation the run's synthetic account authored, joined from the
 * preview database (product intent, payment) and Dotypos (dates, seats).
 */
export type AgentEvalReservationRecord = {
  readonly createdAt: string;
  readonly product:
    | { readonly family: "cowork"; readonly tier: string }
    | {
        readonly family: "meeting-room";
        readonly duration?: { readonly unit: string; readonly amount: number };
      }
    | {
        readonly family: "office";
        readonly seats?: number;
        readonly dayCount?: number;
      };
  /** Dotypos interval as ISO instants; absent before a hold exists. */
  readonly startsAt?: string;
  readonly endsAt?: string;
  readonly seats?: number;
  readonly providerStatus?: "NEW" | "CONFIRMED" | "CANCELLED";
  readonly paid: boolean;
};

/** What the judge read from the status page after a payment run. */
export type AgentEvalStatusPageCheck = {
  /** The agent's browser reached the reservation status page. */
  readonly reachedByAgent: boolean;
  /** The status page showed the confirmed reservation. */
  readonly confirmed: boolean;
};

export type AgentEvalJudgementReason =
  | "matched"
  | "missing-facts"
  | "no-reservation"
  | "reservation-cancelled"
  | "wrong-product"
  | "wrong-date"
  | "wrong-time"
  | "wrong-seats"
  | "wrong-duration"
  | "paid-without-permission"
  | "not-paid"
  | "status-not-reached"
  | "status-not-confirmed";

export type AgentEvalFact = "price" | "opening-hours" | "address";

export type AgentEvalJudgement = {
  readonly success: boolean;
  readonly reason: AgentEvalJudgementReason;
  /** Facts the final answer missed; facts task only. */
  readonly missingFacts?: readonly AgentEvalFact[];
};

/**
 * The facts the facts task asks for. Price and address come from the
 * catalog and site constants. Opening hours are not yet site data, so this
 * mirrors the published copy ("open 24/7"); read it from the site constants
 * once they carry opening hours.
 */
export const agentEvalFacts = {
  reservedDeskDailyPriceCzk: moneyMajorAmount(
    getWorkspaceProductByTier("reserved-desk").price
  ),
  openingHours: "24/7",
  address: workspaceSiteConstants.location.address,
} as const;

const normalizeAnswer = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ");

const mentionsAmount = (answer: string, amount: number) =>
  new RegExp(
    `(?<![\\d.,])${escapeRegExp(String(amount))}(?:[.,]0{1,2})?(?![\\d])`
  ).test(answer.replace(/(\d)[   ](?=\d{3}\b)/g, "$1"));

const mentionsAlwaysOpen = (answer: string) =>
  /24\s*\/\s*7|24\s*(?:h\b|hodin|hours)|non-?stop|around the clock|nepretrzit/.test(
    normalizeAnswer(answer)
  );

const mentionsAddress = (answer: string) => {
  const normalized = normalizeAnswer(answer);
  const [street = "", number = ""] = normalizeAnswer(
    agentEvalFacts.address.street
  ).split(/ (?=\d)/);
  return normalized.includes(street) && normalized.includes(number);
};

/** Judges the facts task from the agent's final answer alone. */
export const judgeAgentEvalFacts = (
  finalAnswer: string
): AgentEvalJudgement => {
  const missingFacts: AgentEvalFact[] = [];
  if (!mentionsAmount(finalAnswer, agentEvalFacts.reservedDeskDailyPriceCzk)) {
    missingFacts.push("price");
  }
  if (!mentionsAlwaysOpen(finalAnswer)) missingFacts.push("opening-hours");
  if (!mentionsAddress(finalAnswer)) missingFacts.push("address");
  return missingFacts.length === 0
    ? { reason: "matched", success: true }
    : { missingFacts, reason: "missing-facts", success: false };
};

const pragueParts = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "2-digit",
  timeZone: workspaceSiteConstants.location.timeZone,
  year: "numeric",
});

/** Prague-local date and time of an instant. */
export const toPragueLocal = (instant: string) => {
  const parts = Object.fromEntries(
    pragueParts
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
};

const hoursBetween = (startsAt: string, endsAt: string) =>
  (Date.parse(endsAt) - Date.parse(startsAt)) / 3_600_000;

const pragueDayCount = (startsAt: string, endsAt: string) => {
  const first = toPragueLocal(startsAt).date;
  const last = toPragueLocal(
    new Date(Date.parse(endsAt) - 1).toISOString()
  ).date;
  return (
    (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) /
      86_400_000 +
    1
  );
};

const failed = (reason: AgentEvalJudgementReason): AgentEvalJudgement => ({
  reason,
  success: false,
});

const matched: AgentEvalJudgement = { reason: "matched", success: true };

/**
 * The run's outcome is its final state: the newest reservation the account
 * authored. Earlier abandoned drafts don't count against the agent.
 */
const newestReservation = (records: readonly AgentEvalReservationRecord[]) =>
  [...records].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt)
  )[0];

const judgeOpenSpace = (
  record: AgentEvalReservationRecord,
  date: string
): AgentEvalJudgement => {
  if (
    record.product.family !== "cowork" ||
    record.product.tier !== "open-space"
  )
    return failed("wrong-product");
  if (!record.startsAt || toPragueLocal(record.startsAt).date !== date)
    return failed("wrong-date");
  return matched;
};

const judgeMeetingRoom = (
  record: AgentEvalReservationRecord,
  parameters: Extract<
    AgentEvalTaskParameters,
    { readonly taskId: "meeting-room-to-pay" }
  >
): AgentEvalJudgement => {
  if (record.product.family !== "meeting-room") return failed("wrong-product");
  if (!record.startsAt || !record.endsAt) return failed("wrong-date");
  const start = toPragueLocal(record.startsAt);
  if (start.date !== parameters.date) return failed("wrong-date");
  const duration = record.product.duration;
  const durationMatches = duration
    ? duration.unit === "hour" && duration.amount === agentEvalMeetingRoomHours
    : hoursBetween(record.startsAt, record.endsAt) ===
      agentEvalMeetingRoomHours;
  if (!durationMatches) return failed("wrong-duration");
  if (start.time !== parameters.expectedStartTime) return failed("wrong-time");
  return matched;
};

const judgeOffice = (
  record: AgentEvalReservationRecord,
  startDate: string
): AgentEvalJudgement => {
  if (record.product.family !== "office") return failed("wrong-product");
  if (!record.startsAt || !record.endsAt) return failed("wrong-date");
  if (toPragueLocal(record.startsAt).date !== startDate)
    return failed("wrong-date");
  const dayCount =
    record.product.dayCount ?? pragueDayCount(record.startsAt, record.endsAt);
  if (dayCount !== agentEvalOfficeDays) return failed("wrong-date");
  const seats = record.product.seats ?? record.seats;
  if (seats !== agentEvalOfficeSeats) return failed("wrong-seats");
  return matched;
};

/**
 * Judges a booking or payment task from server records. Booking tasks pass
 * when no reservation the run authored was paid and the newest is a live hold
 * with the requested product and dates; the payment task also needs a paid
 * reservation and a confirmed status page the agent reached.
 */
export const judgeAgentEvalReservation = (
  parameters: Exclude<AgentEvalTaskParameters, { readonly taskId: "facts" }>,
  records: readonly AgentEvalReservationRecord[],
  statusPage?: AgentEvalStatusPageCheck
): AgentEvalJudgement => {
  // A booking task forbids paying, so any payment fails it, even one for an
  // earlier reservation the agent later abandoned.
  if (
    parameters.taskId !== "open-space-payment" &&
    records.some((record) => record.paid)
  ) {
    return failed("paid-without-permission");
  }
  const record = newestReservation(records);
  if (!record) return failed("no-reservation");
  if (record.providerStatus === "CANCELLED")
    return failed("reservation-cancelled");

  switch (parameters.taskId) {
    case "open-space-to-pay":
    case "meeting-room-to-pay":
    case "office-to-pay": {
      let judgement: AgentEvalJudgement;
      if (parameters.taskId === "open-space-to-pay") {
        judgement = judgeOpenSpace(record, parameters.date);
      } else if (parameters.taskId === "meeting-room-to-pay") {
        judgement = judgeMeetingRoom(record, parameters);
      } else {
        judgement = judgeOffice(record, parameters.startDate);
      }
      return judgement;
    }
    case "open-space-payment": {
      const judgement = judgeOpenSpace(record, parameters.date);
      if (!judgement.success) return judgement;
      if (!record.paid) return failed("not-paid");
      if (!statusPage?.reachedByAgent) return failed("status-not-reached");
      if (!statusPage.confirmed) return failed("status-not-confirmed");
      return matched;
    }
  }
};

/** Failure categories reported per run and counted in the results table. */
export const agentEvalFailureCategories = [
  "navigation",
  "form-control",
  "date-picker",
  "sign-in",
  "payment-tab",
  "other",
] as const;

export type AgentEvalFailureCategory =
  (typeof agentEvalFailureCategories)[number];

/** How the harness process ended. */
export type AgentEvalHarnessOutcomeKind =
  | "completed"
  | "agent-error"
  | "timeout"
  | "exit"
  | "invalid-response"
  | "spawn-failure";

const reservationRouteByTask = {
  "meeting-room-to-pay": "reservation-meeting-room",
  "office-to-pay": "reservation-office",
  "open-space-payment": "reservation-cowork",
  "open-space-to-pay": "reservation-cowork",
} as const;

/**
 * Attributes a failed run to the first place the agent went wrong, from the
 * judgement and what the browser showed. A harness that never produced a
 * usable run counts as "other": it says nothing about the site.
 */
export const classifyAgentEvalFailure = ({
  harnessOutcome,
  judgement,
  observations,
  taskId,
}: {
  readonly harnessOutcome: AgentEvalHarnessOutcomeKind;
  readonly judgement: AgentEvalJudgement;
  readonly observations: Pick<AgentEvalBrowserObservations, "routes">;
  readonly taskId: AgentEvalTaskParameters["taskId"];
}): AgentEvalFailureCategory | null => {
  if (judgement.success) return null;
  if (
    harnessOutcome === "spawn-failure" ||
    harnessOutcome === "invalid-response"
  ) {
    return "other";
  }
  switch (judgement.reason) {
    case "wrong-date":
    case "wrong-time":
      return "date-picker";
    case "wrong-product":
    case "wrong-seats":
    case "wrong-duration":
      return "form-control";
    case "paid-without-permission":
    case "not-paid":
    case "status-not-reached":
    case "status-not-confirmed":
      return "payment-tab";
    case "no-reservation": {
      if (observations.routes.includes("sign-in")) return "sign-in";
      if (taskId === "facts") return "other";
      return observations.routes.includes(reservationRouteByTask[taskId])
        ? "form-control"
        : "navigation";
    }
    default:
      return "other";
  }
};
