import { Match } from "effect";
import { getWorkspaceProductTierTitle } from "@/features/checkout/product-catalog.i18n";
import { type Locale, m } from "@/features/i18n";
import { formatMeetingRoomReservationDisplayTimeValue } from "@/features/reservation/meeting-room-reservation-display-time";
import { formatReservationInputDate } from "@/features/reservation/reservation-date";
import type { WorkspaceAvailabilityUnavailableTarget } from "@/features/reservation/workspace-availability";

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
  readonly reservation: WorkspaceAvailabilityUnavailableTarget;
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
      office: () =>
        m.reservationOfficeUnavailable({}, { locale: input.locale }),
    })
  );

/**
 * A reservation form's checkout availability: the family's unavailable
 * message when availability rules the selection out, else the availability
 * error when the check failed.
 */
export const getReservationCheckoutAvailability = ({
  isError,
  isPending,
  locale,
  unavailable,
}: {
  readonly isError: boolean;
  readonly isPending: boolean;
  readonly locale: Locale;
  /** The selection availability rules out, if it does. */
  readonly unavailable?: Omit<
    Parameters<typeof getReservationAvailabilityUnavailableMessage>[0],
    "locale"
  >;
}) => {
  if (unavailable) {
    return {
      isPending,
      unavailableMessage: getReservationAvailabilityUnavailableMessage({
        ...unavailable,
        locale,
      }),
    };
  }

  return {
    isPending,
    unavailableMessage: isError
      ? m.reservationAvailabilityError({}, { locale })
      : undefined,
  };
};
