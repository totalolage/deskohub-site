import { Effect, Match, Schema } from "effect";
import {
  type WorkspaceCoworkCurrentTier,
  workspaceCoworkCurrentTiers,
} from "@/features/checkout/product-catalog";
import { m } from "@/features/i18n";
import { loadAdvisoryOfficeSeatCapacity } from "@/features/office/backend/office-advisory-seat-capacity";
import { getShareableReservationUrl } from "@/features/reservation/backend/shareable-reservation-url";
import { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import { getCoworkOfferSearchParams } from "@/features/reservation/cowork-reservation-checkout-query";
import { getMeetingRoomReservationSelectionSearchParams } from "@/features/reservation/meeting-room-reservation-checkout-query";
import { getOfficeReservationSelectionSearchParams } from "@/features/reservation/office-reservation-checkout-query";
import type { ReservationSelectionSearchParams } from "@/features/reservation/reservation-checkout-query";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import {
  getCoworkAvailabilityQueries,
  getMeetingRoomAvailabilityQuery,
  getOfficeAvailabilityQuery,
  isCoworkOfferAvailable,
  isMeetingRoomAvailable,
  type WorkspaceAvailability,
  type WorkspaceAvailabilityQuery,
} from "@/features/reservation/workspace-availability";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  currentInstant,
  temporalInstantToLocalDateTimeString,
} from "@/shared/utils/temporal";
import {
  agentToolLocaleField,
  defineAgentTool,
  getAgentToolLocale,
} from "./agent-tool";
import { AgentToolError } from "./agent-tool-error";
import {
  type CheckAvailabilityResult,
  checkAvailabilityResultSchema,
} from "./check-availability.schema";
import {
  ensureOfficeOpen,
  getRequestedCoworkTiers,
  isCoworkOfferOpen,
  reservationSelectionFields,
  resolveCoworkDates,
  resolveMeetingRoomSelection,
  resolveOfficeRange,
} from "./reservation-selection";

const inputSchema = Schema.Struct({
  ...reservationSelectionFields,
  tier: Schema.optionalKey(
    Schema.Literals(workspaceCoworkCurrentTiers).annotate({
      description:
        "Cowork only: open-space or reserved-desk. Both when omitted.",
    })
  ),
  locale: agentToolLocaleField,
});

type CheckAvailabilityInput = typeof inputSchema.Type;

type AvailabilityResult = Omit<
  CheckAvailabilityResult,
  "checked_at" | "note" | "reservation_url"
> & { readonly reservationSearchParams: ReservationSelectionSearchParams };

export const checkAvailabilityTool = defineAgentTool({
  name: "check_availability",
  title: "Check Deskohub Workspace availability",
  description:
    "Checks whether a Deskohub Workspace product looks free: cowork desks for a date or date range, the meeting room for a start time and duration, or the office for a date range and seats. Answers are advisory, from a cache refreshed every minute; availability is confirmed when the customer books on the website.",
  access: "public",
  readOnly: true,
  unavailableCode: "availability_unavailable",
  input: inputSchema,
  output: checkAvailabilityResultSchema,
  run: Effect.fn("agentTools.checkAvailability")((input) =>
    Effect.succeed({ input }).pipe(
      Effect.let("locale", ({ input }) => getAgentToolLocale(input)),
      Effect.bind("now", () => currentInstant),
      Effect.bind("availability", checkSelectionAvailability),
      Effect.bind("reservationUrl", ({ input, availability }) =>
        getShareableReservationUrl(
          input.family,
          availability.reservationSearchParams
        ).pipe(
          Effect.mapError(
            AgentToolError.unavailable("availability_unavailable")
          )
        )
      ),
      Effect.map(
        ({
          locale,
          now,
          availability: { reservationSearchParams: _, ...result },
          reservationUrl,
        }): CheckAvailabilityResult => ({
          ...result,
          checked_at: now.toString(),
          note: m.agentToolAvailabilityAdvisoryNote({}, { locale }),
          reservation_url: reservationUrl,
        })
      )
    )
  ),
});

const loadAvailability = (query: WorkspaceAvailabilityQuery) =>
  WorkspaceAvailabilityService.pipe(
    Effect.flatMap((service) => service.getAvailability({ query })),
    Effect.mapError(AgentToolError.unavailable("availability_unavailable"))
  );

type AvailabilitySelection = {
  readonly input: CheckAvailabilityInput;
  readonly now: Temporal.Instant;
};

const checkSelectionAvailability = (selection: AvailabilitySelection) =>
  Match.value(selection.input.family).pipe(
    Match.when("cowork", () => checkCowork(selection)),
    Match.when("meeting-room", () => checkMeetingRoom(selection)),
    Match.when("office", () => checkOffice(selection)),
    Match.exhaustive
  );

const checkCowork = Effect.fn("agentTools.checkCoworkAvailability")(
  (selection: AvailabilitySelection) =>
    Effect.succeed(selection).pipe(
      Effect.let("today", ({ now }) => getCurrentWorkspaceDate(now)),
      Effect.bind("dates", ({ input, today }) =>
        resolveCoworkDates({
          date: input.date,
          endDate: input.end_date,
          today,
        })
      ),
      Effect.bind("tierAvailability", ({ input, today }) =>
        loadCoworkTierAvailability({
          tiers: getRequestedCoworkTiers(input.tier),
          today,
        })
      ),
      Effect.let("days", toCoworkDays),
      Effect.map(
        ({ input, days }) =>
          ({
            family: "cowork" as const,
            available: days.every((day) => day.available),
            days,
            reservationSearchParams: getCoworkOfferSearchParams({
              entryTier: input.tier ?? "open-space",
              date: input.date,
            }),
          }) satisfies AvailabilityResult
      )
    )
);

type CoworkTierAvailability = {
  readonly entryTier: WorkspaceCoworkCurrentTier;
  readonly availability: WorkspaceAvailability;
};

// The page's calendar-range query per tier, so the tool shares its
// cached snapshots instead of filling one per requested range.
const loadCoworkTierAvailability = ({
  tiers,
  today,
}: {
  readonly tiers: ReadonlyArray<WorkspaceCoworkCurrentTier>;
  readonly today: Temporal.PlainDate;
}) =>
  Effect.all(
    tiers.flatMap((entryTier) => {
      const { range } = getCoworkAvailabilityQueries({
        entryTier,
        today: today.toString(),
      });
      return range
        ? [
            loadAvailability(range).pipe(
              Effect.map(
                (availability): CoworkTierAvailability => ({
                  entryTier,
                  availability,
                })
              )
            ),
          ]
        : [];
    }),
    { concurrency: "inherit" }
  );

const toCoworkDays = ({
  dates,
  tierAvailability,
  now,
}: {
  readonly dates: ReadonlyArray<string>;
  readonly tierAvailability: ReadonlyArray<CoworkTierAvailability>;
  readonly now: Temporal.Instant;
}) =>
  dates.map((date) => {
    const offers = tierAvailability.map(({ entryTier, availability }) => ({
      tier: entryTier,
      available:
        isCoworkOfferOpen({ entryTier, date, now }) &&
        isCoworkOfferAvailable(availability, { entryTier, date }),
      workstation_required:
        entryTier === "reserved-desk" &&
        availability.reservedDeskWorkstationRequiredDates.includes(date),
    }));
    return {
      date,
      available: offers.some((offer) => offer.available),
      offers,
    };
  });

const checkMeetingRoom = Effect.fn("agentTools.checkMeetingRoomAvailability")(
  (selection: AvailabilitySelection) =>
    Effect.succeed(selection).pipe(
      Effect.bind("meetingRoom", ({ input, now }) =>
        resolveMeetingRoomSelection({
          date: input.date,
          startTime: input.start_time,
          duration: input.duration,
          now,
        })
      ),
      Effect.bind("availability", ({ meetingRoom }) =>
        loadAvailability(getMeetingRoomAvailabilityQuery(meetingRoom.interval))
      ),
      Effect.let("available", ({ availability }) =>
        isMeetingRoomAvailable(availability)
      ),
      Effect.map(({ input, meetingRoom, available }) => {
        const { timeZone } = workspaceSiteConstants.location;

        return {
          family: "meeting-room" as const,
          available,
          days: [{ date: input.date, available }],
          meeting_room: {
            duration: meetingRoom.durationKey,
            starts_at: temporalInstantToLocalDateTimeString({
              instant: Temporal.Instant.from(meetingRoom.interval.startsAt),
              timeZone,
            }),
            ends_at: temporalInstantToLocalDateTimeString({
              instant: Temporal.Instant.from(meetingRoom.interval.endsAt),
              timeZone,
            }),
          },
          reservationSearchParams:
            getMeetingRoomReservationSelectionSearchParams({
              duration: meetingRoom.durationKey,
              startDateTime: meetingRoom.startDateTime,
            }),
        } satisfies AvailabilityResult;
      })
    )
);

const checkOffice = Effect.fn("agentTools.checkOfficeAvailability")(
  (selection: AvailabilitySelection) =>
    Effect.succeed(selection).pipe(
      Effect.tap(() => ensureOfficeOpen),
      Effect.let("today", ({ now }) => getCurrentWorkspaceDate(now)),
      Effect.bind("range", ({ input, today }) =>
        resolveOfficeRange({
          date: input.date,
          endDate: input.end_date,
          today,
        })
      ),
      Effect.let("seats", ({ input }) => input.seats ?? 1),
      Effect.bind("office", ({ today }) => loadOfficeAvailability(today)),
      Effect.let("days", ({ range, office }) =>
        range.dates.map((date) => ({
          date,
          available: !office.availability.unavailableDates.includes(date),
        }))
      ),
      Effect.map(
        ({ range, seats, office, days }) =>
          ({
            family: "office" as const,
            available:
              seats <= office.maximumSeats &&
              days.every((day) => day.available),
            days,
            office: { seats, max_seats: office.maximumSeats },
            reservationSearchParams: getOfficeReservationSelectionSearchParams({
              startsOn: range.startsOn,
              dayCount: range.dates.length,
              seats,
            }),
          }) satisfies AvailabilityResult
      )
    )
);

// The page's booking-horizon query, so the tool shares its snapshot.
const loadOfficeAvailability = (today: Temporal.PlainDate) =>
  Effect.all(
    {
      availability: loadAvailability(
        getOfficeAvailabilityQuery(today.toString())
      ),
      maximumSeats: loadAdvisoryOfficeSeatCapacity.pipe(
        Effect.mapError(AgentToolError.unavailable("availability_unavailable"))
      ),
    },
    { concurrency: "inherit" }
  );
