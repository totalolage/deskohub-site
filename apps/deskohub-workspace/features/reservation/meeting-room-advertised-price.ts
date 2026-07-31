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

const getWholeDayAdvertisedStartDateTime = (
  startDateTime: string,
  minimumStartDateTime: string | undefined
) => {
  if (!minimumStartDateTime) return startDateTime;

  try {
    const selectedDate =
      Temporal.PlainDateTime.from(startDateTime).toPlainDate();
    const minimum = Temporal.PlainDateTime.from(minimumStartDateTime);
    const minimumDate = minimum
      .toPlainTime()
      .equals(Temporal.PlainTime.from("00:00"))
      ? minimum.toPlainDate()
      : minimum.toPlainDate().add({ days: 1 });
    const advertisedDate =
      Temporal.PlainDate.compare(selectedDate, minimumDate) < 0
        ? minimumDate
        : selectedDate;

    return advertisedDate
      .toPlainDateTime()
      .toString({ smallestUnit: "minute" });
  } catch {
    return startDateTime;
  }
};

export const getMeetingRoomDurationAdvertisedPriceRequests = ({
  locale,
  minimumStartDateTime,
  selectableStartDateTime,
  startDateTime,
}: {
  readonly locale: Locale;
  readonly minimumStartDateTime?: string;
  readonly selectableStartDateTime?: string;
  readonly startDateTime: string;
}): ReadonlyArray<MeetingRoomDurationAdvertisedPriceRequest> =>
  workspaceMeetingRoomDurationOptions.flatMap((duration) => {
    const advertisedStartDateTime =
      duration === 1440
        ? getWholeDayAdvertisedStartDateTime(
            startDateTime,
            minimumStartDateTime
          )
        : (selectableStartDateTime ?? startDateTime);
    const interval = getMeetingRoomReservationInterval(
      advertisedStartDateTime,
      duration
    );
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
