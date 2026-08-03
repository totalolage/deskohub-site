import { Match } from "effect";
import type { WorkspaceCoworkProductTier } from "@/features/checkout/product-catalog";
import { getWorkspaceProductTierTitle } from "@/features/checkout/product-catalog.i18n";
import { type Locale, m } from "@/features/i18n";
import { formatMeetingRoomReservationDisplayTimeValue } from "@/features/reservation/meeting-room-reservation-display-time";
import { formatReservationInputDate } from "@/features/reservation/reservation-date";

export const formatMeetingRoomReservationDisplayTime = (
  interval: {
    readonly startsAt: Temporal.Instant;
    readonly endsAt: Temporal.Instant;
  },
  locale: Locale
) =>
  formatMeetingRoomReservationDisplayTimeValue(
    interval,
    locale,
    m.reservationMeetingRoomDurationWholeDay({}, { locale })
  );

export const getReservationAvailabilityUnavailableMessage = (input: {
  readonly date: string;
  readonly dateFallback?: string;
  readonly locale: Locale;
  readonly reservation:
    | {
        readonly kind: "cowork";
        readonly entryTier: WorkspaceCoworkProductTier;
      }
    | {
        readonly kind: "meeting-room";
      };
}) =>
  Match.value(input.reservation).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: ({ entryTier }) =>
        m.reservationAvailabilityUnavailable(
          {
            date: formatReservationInputDate(
              input.date,
              input.locale,
              input.dateFallback
            ),
            tier: getWorkspaceProductTierTitle(entryTier, input.locale),
          },
          { locale: input.locale }
        ),
      "meeting-room": () =>
        m.reservationMeetingRoomUnavailable({}, { locale: input.locale }),
    })
  );
