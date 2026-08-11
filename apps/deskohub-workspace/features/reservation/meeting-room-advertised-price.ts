import { Option, Schema } from "effect";
import type { MeetingRoomAdvertisedPriceRequest } from "@/features/checkout/advertised-price";
import type { Locale } from "@/features/i18n";
import { meetingRoomReservationDurations } from "@/features/reservation/meeting-room-reservation-duration";
import {
  localDateTimeSchema,
  plainDateStringSchema,
} from "@/shared/utils/temporal";

const decodeLocalDateTime = Schema.decodeUnknownOption(localDateTimeSchema);
const decodePlainDate = Schema.decodeUnknownSync(plainDateStringSchema);

export const getMeetingRoomDurationAdvertisedPriceRequests = ({
  locale,
  startDateTime,
}: {
  readonly locale: Locale;
  readonly startDateTime: string;
}): ReadonlyArray<MeetingRoomAdvertisedPriceRequest> =>
  decodeLocalDateTime(startDateTime).pipe(
    Option.map((dateTime) =>
      decodePlainDate(
        Temporal.PlainDateTime.from(dateTime).toPlainDate().toString()
      )
    ),
    Option.map((reservationDate) =>
      meetingRoomReservationDurations.map((duration) => ({
        locale,
        reservation: {
          kind: "meeting-room" as const,
          details: {
            kind: "meeting-room" as const,
            duration,
            reservationDate,
          },
        },
      }))
    ),
    Option.getOrElse(() => [])
  );
