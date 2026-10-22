import { Schema } from "effect";
import { workspaceCoworkCurrentTiers } from "@/features/checkout/product-catalog";
import { locales } from "@/features/i18n";
import { meetingRoomReservationDurationKeySchema } from "@/features/reservation/meeting-room-reservation-duration";
import { workspaceReservationKindSchema } from "@/features/reservation/reservation-kind";
import { agentOfferingSchema } from "./list-offerings.schema";

/**
 * How the customer finishes in the booking view: start the booking there and
 * pay on the Pay page, or open the prefilled reservation page.
 */
const bookingModes = ["reserve", "reservation_page"] as const;

export type BookingMode = (typeof bookingModes)[number];

export const showBookingResultSchema = Schema.Struct({
  booking_mode: Schema.Literals(bookingModes).annotate({
    description:
      "How the customer finishes in the view. reserve: the customer starts the booking in the view. reservation_page: the view links to the reservation page, prefilled with the selection.",
  }),
  locale: Schema.Literals(locales).annotate({
    description: "Language of the names and the note in the result.",
  }),
  selection: Schema.Struct({
    family: Schema.optionalKey(workspaceReservationKindSchema),
    date: Schema.optionalKey(Schema.String),
    end_date: Schema.optionalKey(Schema.String),
    tier: Schema.optionalKey(Schema.Literals(workspaceCoworkCurrentTiers)),
    duration: Schema.optionalKey(meetingRoomReservationDurationKeySchema),
    start_time: Schema.optionalKey(Schema.String),
    seats: Schema.optionalKey(Schema.Int),
  }).annotate({ description: "The choices the view opens with." }),
  advertised_on: Schema.String.annotate({
    description: "Prague date (YYYY-MM-DD) the advertised prices are for.",
  }),
  offerings: Schema.Array(agentOfferingSchema),
  note: Schema.String,
});

export type ShowBookingResult = typeof showBookingResultSchema.Type;
