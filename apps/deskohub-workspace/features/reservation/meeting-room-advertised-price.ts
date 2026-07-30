import type { AdvertisedPriceRequest } from "@/features/checkout/advertised-price";
import {
  type WorkspaceMeetingRoomDurationMinutes,
  workspaceMeetingRoomDurationOptions,
} from "@/features/checkout/product-catalog";
import type { Locale } from "@/features/i18n";
import { getMeetingRoomReservationInterval } from "@/features/reservation/meeting-room-reservation-time";

export type MeetingRoomDurationAdvertisedPriceRequest = {
  readonly duration: WorkspaceMeetingRoomDurationMinutes;
  readonly request: AdvertisedPriceRequest;
};

export const getMeetingRoomDurationAdvertisedPriceRequests = ({
  locale,
  startDateTime,
}: {
  readonly locale: Locale;
  readonly startDateTime: string;
}): ReadonlyArray<MeetingRoomDurationAdvertisedPriceRequest> =>
  workspaceMeetingRoomDurationOptions.flatMap((duration) => {
    const interval = getMeetingRoomReservationInterval(startDateTime, duration);
    if (!interval) return [];

    return [
      {
        duration,
        request: {
          locale,
          reservation: {
            kind: "meeting-room",
            details: {
              kind: "meeting-room",
              ...interval,
            },
          },
        },
      },
    ];
  });
