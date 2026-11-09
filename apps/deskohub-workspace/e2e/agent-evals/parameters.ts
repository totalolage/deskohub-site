import { Effect, Schema } from "effect";
import type { HttpClient } from "effect/unstable/http";
import type { MeetingRoomReservationDuration } from "@/features/reservation/meeting-room-reservation-duration";
import {
  getMeetingRoomReservationDate,
  getMeetingRoomReservationInterval,
} from "@/features/reservation/meeting-room-reservation-time";
import {
  getOfficeReservationIntervalInput,
  getOfficeReservationMaximumEndsOn,
  officeReservationDetailsSchema,
} from "@/features/reservation/office-reservation";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import {
  loadAvailableCoworkDates,
  loadMeetingRoomAvailability,
  loadOfficeAvailability,
  type MeetingRoomCheckoutSlot,
  type OfficeCheckoutSlot,
} from "../checkout/data";
import type { WorkspaceE2EConfig } from "../config";
import {
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";
import {
  type AgentEvalTaskId,
  type AgentEvalTaskParameters,
  agentEvalMeetingRoomEarliestStart,
  agentEvalMeetingRoomHours,
  agentEvalOfficeDays,
  agentEvalOfficeSeats,
} from "./tasks";

/**
 * Date windows that stay clear of the E2E suites sharing the Dotypos
 * sandbox: checkout cases book 14 to 90 days out, the account lane 120, and
 * the accessibility audit's Pay case 175 to 180 (e2e/accessibility/pay-page.ts).
 * Office bookings end at most a month out, so office evals take the days
 * before the checkout window.
 */
const agentEvalDateWindows = {
  cowork: { fromOffsetDays: 125, toOffsetDays: 170 },
  meetingRoom: { fromOffsetDays: 125, toOffsetDays: 170 },
  office: { fromOffsetDays: 2, toOffsetDays: 13 },
} as const;

const meetingRoomDuration = {
  amount: agentEvalMeetingRoomHours,
  unit: "hour",
} as const satisfies MeetingRoomReservationDuration;

const latestMeetingRoomStartHour = 24 - agentEvalMeetingRoomHours;

const offsetDate = (offsetDays: number) =>
  getCurrentWorkspaceDate().add({ days: offsetDays }).toString();

/**
 * Concurrent runs take different dates, so two agents never compete for the
 * one office or the same meeting-room day. `lane` is the Playwright worker's
 * parallel index; `lanes` the worker count.
 */
type AgentEvalLane = { readonly lane: number; readonly lanes: number };

const pickCoworkDate = Effect.fn("pickCoworkDate")(function* (
  config: WorkspaceE2EConfig,
  { lane, lanes }: AgentEvalLane
) {
  const dates = yield* loadAvailableCoworkDates(config, {
    allocation: {
      ...agentEvalDateWindows.cowork,
      shardCount: 1,
      shardIndex: 0,
    },
    entryTier: "open-space",
  });
  const laneDates = dates.filter((_, index) => index % lanes === lane);
  const date = laneDates[0] ?? dates[0];
  if (date) return date;
  return yield* workspaceE2EError(
    "No available Open Space date in the agent eval window",
    { operation: "select agent eval Open Space date" }
  );
});

const makeMeetingRoomSlot = (date: string, hour: number) =>
  tryWorkspaceE2ESync("create agent eval meeting-room slot", () => {
    const startDateTime = `${date}T${String(hour).padStart(2, "0")}:00`;
    const interval = getMeetingRoomReservationInterval(
      startDateTime,
      meetingRoomDuration
    );
    if (!interval)
      throw new Error("meeting-room interval could not be created");
    return {
      date: getMeetingRoomReservationDate(interval),
      duration: meetingRoomDuration,
      endsAt: interval.endsAt,
      startDateTime,
      startsAt: interval.startsAt,
    } satisfies MeetingRoomCheckoutSlot;
  });

const firstMeetingRoomHour = Number(
  agentEvalMeetingRoomEarliestStart.slice(0, 2)
);

const pickMeetingRoomStart = Effect.fn("pickMeetingRoomStart")(function* (
  config: WorkspaceE2EConfig,
  { lane, lanes }: AgentEvalLane
) {
  const window = agentEvalDateWindows.meetingRoom;
  for (
    let offset = window.fromOffsetDays + lane;
    offset <= window.toOffsetDays;
    offset += lanes
  ) {
    const date = offsetDate(offset);
    for (
      let hour = firstMeetingRoomHour;
      hour <= latestMeetingRoomStartHour;
      hour += 1
    ) {
      const slot = yield* makeMeetingRoomSlot(date, hour);
      const availability = yield* loadMeetingRoomAvailability(config, slot);
      if (
        !availability.meetingRoomUnavailable &&
        availability.unavailableDates.length === 0
      ) {
        return {
          date,
          expectedStartTime: `${String(hour).padStart(2, "0")}:00`,
        };
      }
    }
  }
  return yield* workspaceE2EError(
    "No free 4-hour meeting-room start in the agent eval window",
    { operation: "select agent eval meeting-room start" }
  );
});

const decodeOfficeDetails = Schema.decodeUnknownSync(
  officeReservationDetailsSchema
);

const makeOfficeSlot = (startsOn: string) =>
  tryWorkspaceE2ESync("create agent eval office slot", () => {
    const endsOn = Temporal.PlainDate.from(startsOn)
      .add({ days: agentEvalOfficeDays - 1 })
      .toString();
    const interval = getOfficeReservationIntervalInput(
      decodeOfficeDetails({
        endsOn,
        kind: "office",
        seats: agentEvalOfficeSeats,
        startsOn,
      })
    );
    return {
      endsAt: interval.endsAt,
      endsOn,
      seats: agentEvalOfficeSeats,
      startsAt: interval.startsAt,
      startsOn,
    } satisfies OfficeCheckoutSlot;
  });

const pickOfficeStart = Effect.fn("pickOfficeStart")(function* (
  config: WorkspaceE2EConfig,
  { lane, lanes }: AgentEvalLane
) {
  const window = agentEvalDateWindows.office;
  const horizon = getOfficeReservationMaximumEndsOn().toString();
  for (
    let offset = window.fromOffsetDays + lane * agentEvalOfficeDays;
    offset + agentEvalOfficeDays - 1 <= window.toOffsetDays;
    offset += lanes * agentEvalOfficeDays
  ) {
    const slot = yield* makeOfficeSlot(offsetDate(offset));
    if (slot.endsOn > horizon) break;
    const availability = yield* loadOfficeAvailability(config, slot);
    if (
      !availability.officeUnavailable &&
      availability.unavailableDates.length === 0
    ) {
      return slot.startsOn;
    }
  }
  return yield* workspaceE2EError(
    "No free 3-day office range in the agent eval window",
    { operation: "select agent eval office range" }
  );
});

/**
 * Picks the run's concrete inputs from the preview's live availability, so
 * every booking task is possible when the agent starts.
 */
export const selectAgentEvalTaskParameters = (
  taskId: AgentEvalTaskId,
  config: WorkspaceE2EConfig,
  lane: AgentEvalLane
): Effect.Effect<
  AgentEvalTaskParameters,
  WorkspaceE2EError,
  HttpClient.HttpClient
> => {
  switch (taskId) {
    case "facts":
      return Effect.succeed({ taskId });
    case "open-space-to-pay":
    case "open-space-payment":
      return pickCoworkDate(config, lane).pipe(
        Effect.map((date) => ({ date, taskId }))
      );
    case "meeting-room-to-pay":
      return pickMeetingRoomStart(config, lane).pipe(
        Effect.map((start) => ({ ...start, taskId }))
      );
    case "office-to-pay":
      return pickOfficeStart(config, lane).pipe(
        Effect.map((startDate) => ({ startDate, taskId }))
      );
  }
};
