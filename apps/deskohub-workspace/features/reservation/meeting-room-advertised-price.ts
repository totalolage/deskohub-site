import { Option, Schema } from "effect";
import type { MeetingRoomAdvertisedPriceRequest } from "@/features/checkout/advertised-price";
import type { CanonicalPromotionCode } from "@/features/discounts";
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
  submittedCode,
}: {
  readonly locale: Locale;
  readonly startDateTime: string;
  readonly submittedCode?: CanonicalPromotionCode;
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
        submittedCode,
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
