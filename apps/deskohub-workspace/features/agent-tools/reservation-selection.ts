import { Schema } from "effect";
import { meetingRoomReservationDurationKeySchema } from "@/features/reservation/meeting-room-reservation-duration";
import { workspaceReservationKindSchema } from "@/features/reservation/reservation-kind";
import { isPlainDateString } from "@/shared/utils/temporal";

// Tool arguments use inline schemas without identifiers, so each published
// property carries its own type and description instead of a shared `$ref`.
const workspaceDateArgument = (description: string) =>
  Schema.String.annotate({ description })
    .check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/), isPlainDateString())
    .pipe(Schema.brand("PlainDate"));

/** Selection fields shared by the availability and quote tools. */
export const reservationSelectionFields = {
  family: workspaceReservationKindSchema.annotate({
    description:
      "Reservation family: cowork (a desk for a day), meeting-room, or office (a private office for whole days).",
  }),
  date: workspaceDateArgument(
    "Prague calendar date in YYYY-MM-DD format. For an office or a cowork range, the first date."
  ),
  end_date: Schema.optionalKey(
    workspaceDateArgument(
      "Cowork or office only: the last date, inclusive, in YYYY-MM-DD format. Defaults to date."
    )
  ),
  start_time: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "Meeting room only: Prague start time in HH:mm on the hour, such as 09:00; the booking must end after the current time (a booking already in progress is allowed). Not used for the whole-day booking.",
    }).check(Schema.isPattern(/^\d{2}:\d{2}$/))
  ),
  duration: Schema.optionalKey(
    meetingRoomReservationDurationKeySchema.annotate({
      description:
        "Meeting room only: hour:1 (one hour), hour:4 (four hours), or day:1 (a whole Prague calendar day, today included until it ends).",
    })
  ),
  seats: Schema.optionalKey(
    Schema.Int.annotate({
      description: "Office only: number of seats. Defaults to 1.",
    }).check(Schema.isGreaterThanOrEqualTo(1))
  ),
};

/**
 * The shared fields for a quote: a cowork booking covers one date, so only an
 * office takes a date range.
 */
export const quoteSelectionFields = {
  ...reservationSelectionFields,
  date: workspaceDateArgument(
    "Prague calendar date in YYYY-MM-DD format. For an office, the first date."
  ),
  end_date: Schema.optionalKey(
    workspaceDateArgument(
      "Office only: the last date, inclusive, in YYYY-MM-DD format. Defaults to date."
    )
  ),
};
