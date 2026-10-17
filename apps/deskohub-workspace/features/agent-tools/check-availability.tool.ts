import { Effect, Match, Schema } from "effect";
import { workspaceCoworkCurrentTiers } from "@/features/checkout/product-catalog";
import { m } from "@/features/i18n";
import { loadAdvisoryOfficeSeatCapacity } from "@/features/office/backend/office-reservation-capacity";
import { getShareableReservationUrl } from "@/features/reservation/backend/shareable-reservation-url";
import { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import { getCoworkReservationSearchParams } from "@/features/reservation/cowork-reservation-checkout-query";
import { getMeetingRoomReservationSearchParams } from "@/features/reservation/meeting-room-reservation-checkout-query";
import { getOfficeReservationSearchParams } from "@/features/reservation/office-reservation-checkout-query";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { workspaceReservationKindSchema } from "@/features/reservation/reservation-kind";
import {
  getCoworkAvailabilityQueries,
  getMeetingRoomAvailabilityQuery,
  getOfficeAvailabilityQuery,
  isCoworkOfferAvailable,
  isMeetingRoomAvailable,
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

const outputSchema = Schema.Struct({
  family: workspaceReservationKindSchema,
  available: Schema.Boolean.annotate({
    description:
      "Whether the whole selection looked free: every date for cowork (some requested offer on each) and office, the interval for the meeting room.",
  }),
  days: Schema.Array(
    Schema.Struct({
      date: Schema.String,
      available: Schema.Boolean,
      offers: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({
            tier: Schema.Literals(workspaceCoworkCurrentTiers),
            available: Schema.Boolean,
            workstation_required: Schema.Boolean,
          })
        )
      ),
    })
  ),
  meeting_room: Schema.optionalKey(
    Schema.Struct({
      duration: Schema.String,
      starts_at: Schema.String,
      ends_at: Schema.String,
    })
  ),
  office: Schema.optionalKey(
    Schema.Struct({
      seats: Schema.Int,
      max_seats: Schema.Int,
    })
  ),
  checked_at: Schema.String,
  note: Schema.String,
  reservation_url: Schema.String,
});

export type CheckAvailabilityResult = typeof outputSchema.Type;

type AvailabilityResult = Omit<
  typeof outputSchema.Type,
  "checked_at" | "note" | "reservation_url"
> & { readonly reservationSearchParams: URLSearchParams };

export const checkAvailabilityTool = defineAgentTool({
  name: "check_availability",
  title: "Check DH Workspace availability",
  description:
    "Checks whether a DH Workspace product looks free: cowork desks for a date or date range, the meeting room for a start time and duration, or the office for a date range and seats. Answers are advisory, from a cache refreshed every minute; availability is confirmed when the customer books on the website.",
  access: "public",
  readOnly: true,
  unavailableCode: "availability_unavailable",
  input: inputSchema,
  output: outputSchema,
  run: Effect.fn("agentTools.checkAvailability")(function* (input) {
    const locale = getAgentToolLocale(input);
    const now = yield* currentInstant;
    const { reservationSearchParams, ...result } = yield* Match.value(
      input.family
    ).pipe(
      Match.when("cowork", () => checkCowork({ input, now })),
      Match.when("meeting-room", () => checkMeetingRoom({ input, now })),
      Match.when("office", () => checkOffice({ input, now })),
      Match.exhaustive
    );
    const reservationUrl = yield* getShareableReservationUrl(
      input.family,
      reservationSearchParams
    ).pipe(
      Effect.mapError(AgentToolError.unavailable("availability_unavailable"))
    );

    return {
      ...result,
      checked_at: now.toString(),
      note: m.agentToolAvailabilityAdvisoryNote({}, { locale }),
      reservation_url: reservationUrl,
    };
  }),
});

const loadAvailability = (query: WorkspaceAvailabilityQuery) =>
  WorkspaceAvailabilityService.pipe(
    Effect.flatMap((service) => service.getAvailability({ query })),
    Effect.mapError(AgentToolError.unavailable("availability_unavailable"))
  );

const checkCowork = Effect.fn("agentTools.checkCoworkAvailability")(function* ({
  input,
  now,
}: {
  readonly input: CheckAvailabilityInput;
  readonly now: Temporal.Instant;
}) {
  const today = getCurrentWorkspaceDate(now);
  const dates = yield* resolveCoworkDates({
    date: input.date,
    endDate: input.end_date,
    today,
  });
  const tiers = getRequestedCoworkTiers(input.tier);
  // The page's calendar-range query per tier, so the tool shares its
  // cached snapshots instead of filling one per requested range.
  const tierAvailability = yield* Effect.all(
    tiers.flatMap((entryTier) => {
      const { range } = getCoworkAvailabilityQueries({
        entryTier,
        today: today.toString(),
      });
      return range
        ? [
            loadAvailability(range).pipe(
              Effect.map((availability) => ({ entryTier, availability }))
            ),
          ]
        : [];
    }),
    { concurrency: "inherit" }
  );
  const days = dates.map((date) => {
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

  return {
    family: "cowork" as const,
    available: days.every((day) => day.available),
    days,
    reservationSearchParams: getCoworkReservationSearchParams({
      entryTier: input.tier ?? "open-space",
      date: input.date,
    }),
  } satisfies AvailabilityResult;
});

const checkMeetingRoom = Effect.fn("agentTools.checkMeetingRoomAvailability")(
  function* ({
    input,
    now,
  }: {
    readonly input: CheckAvailabilityInput;
    readonly now: Temporal.Instant;
  }) {
    const selection = yield* resolveMeetingRoomSelection({
      date: input.date,
      startTime: input.start_time,
      duration: input.duration,
      now,
    });
    const availability = yield* loadAvailability(
      getMeetingRoomAvailabilityQuery(selection.interval)
    );
    const available = isMeetingRoomAvailable(availability);
    const { timeZone } = workspaceSiteConstants.location;

    return {
      family: "meeting-room" as const,
      available,
      days: [{ date: input.date, available }],
      meeting_room: {
        duration: selection.durationKey,
        starts_at: temporalInstantToLocalDateTimeString({
          instant: Temporal.Instant.from(selection.interval.startsAt),
          timeZone,
        }),
        ends_at: temporalInstantToLocalDateTimeString({
          instant: Temporal.Instant.from(selection.interval.endsAt),
          timeZone,
        }),
      },
      reservationSearchParams: getMeetingRoomReservationSearchParams({
        duration: selection.durationKey,
        startDateTime: selection.startDateTime,
      }),
    } satisfies AvailabilityResult;
  }
);

const checkOffice = Effect.fn("agentTools.checkOfficeAvailability")(function* ({
  input,
  now,
}: {
  readonly input: CheckAvailabilityInput;
  readonly now: Temporal.Instant;
}) {
  yield* ensureOfficeOpen;
  const today = getCurrentWorkspaceDate(now);
  const range = yield* resolveOfficeRange({
    date: input.date,
    endDate: input.end_date,
    today,
  });
  const seats = input.seats ?? 1;
  // The page's booking-horizon query, so the tool shares its snapshot.
  const [availability, maximumSeats] = yield* Effect.all(
    [
      loadAvailability(getOfficeAvailabilityQuery(today.toString())),
      loadAdvisoryOfficeSeatCapacity.pipe(
        Effect.mapError(AgentToolError.unavailable("availability_unavailable"))
      ),
    ],
    { concurrency: "inherit" }
  );
  const days = range.dates.map((date) => ({
    date,
    available: !availability.unavailableDates.includes(date),
  }));

  return {
    family: "office" as const,
    available: seats <= maximumSeats && days.every((day) => day.available),
    days,
    office: { seats, max_seats: maximumSeats },
    reservationSearchParams: getOfficeReservationSearchParams({
      seats,
      ...(range.startsOn === today.toString() && {
        dayCount: range.dates.length,
      }),
    }),
  } satisfies AvailabilityResult;
});
