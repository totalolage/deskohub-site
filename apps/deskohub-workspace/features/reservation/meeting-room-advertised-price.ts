import { Option, Schema } from "effect";
import {
  getAdvertisedProductAmount,
  isMeetingRoomAdvertisedPrice,
  type MeetingRoomAdvertisedPrice,
  type MeetingRoomAdvertisedPriceRequest,
} from "@/features/checkout/advertised-price";
import type { CanonicalPromotionCode } from "@/features/discounts";
import type { Locale } from "@/features/i18n";
import type { AdvertisedOptionFamily } from "@/features/reservation/advertised-option-prices";
import {
  getMeetingRoomReservationDurationKey,
  type MeetingRoomReservationDurationKey,
  meetingRoomReservationDurations,
} from "@/features/reservation/meeting-room-reservation-duration";
import {
  getMeetingRoomLastServiceDate,
  getMeetingRoomReservationInterval,
} from "@/features/reservation/meeting-room-reservation-time";
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
    Option.map((dateTime) => {
      const reservationDate = decodePlainDate(
        Temporal.PlainDateTime.from(dateTime).toPlainDate().toString()
      );

      return meetingRoomReservationDurations.flatMap((duration) => {
        const interval = getMeetingRoomReservationInterval(dateTime, duration);

        return interval
          ? [
              {
                locale,
                ...(submittedCode && { submittedCode }),
                reservation: {
                  kind: "meeting-room" as const,
                  details: {
                    kind: "meeting-room" as const,
                    duration,
                    reservationDate,
                    lastServiceDate: getMeetingRoomLastServiceDate(interval),
                  },
                },
              },
            ]
          : [];
      });
    }),
    Option.getOrElse(() => [])
  );

/** Each duration option shows its own product line's advertised amount. */
export const meetingRoomDurationOptions: AdvertisedOptionFamily<
  MeetingRoomAdvertisedPriceRequest,
  MeetingRoomAdvertisedPrice
> = {
  isPrice: isMeetingRoomAdvertisedPrice,
  amountOf: (price, { reservation: { details } }) =>
    getAdvertisedProductAmount(price, {
      kind: "meeting-room",
      duration: details.duration,
    }),
};

export const findMeetingRoomDurationAdvertisedPriceRequest = (
  requests: ReadonlyArray<MeetingRoomAdvertisedPriceRequest>,
  durationKey: MeetingRoomReservationDurationKey
) =>
  requests.find(
    ({ reservation: { details } }) =>
      getMeetingRoomReservationDurationKey(details.duration) === durationKey
  );
