import { Schema } from "effect";
import {
  workspaceCoworkCurrentTiers,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import { meetingRoomReservationDurationKeySchema } from "@/features/reservation/meeting-room-reservation-duration";
import { workspaceReservationKindSchema } from "@/features/reservation/reservation-kind";
import { agentToolMoneySchema } from "./agent-tool-money";

export const agentOfferingSchema = Schema.Struct({
  family: workspaceReservationKindSchema,
  tier: Schema.optionalKey(Schema.Literals(workspaceCoworkCurrentTiers)),
  duration: Schema.optionalKey(meetingRoomReservationDurationKeySchema),
  duration_label: Schema.optionalKey(Schema.String),
  name: Schema.String,
  description: Schema.String,
  usage: Schema.String,
  price: agentToolMoneySchema.annotate({
    description: "Regular price per price_unit.",
  }),
  price_unit: Schema.Literals(["day", "booking"]),
  advertised_price: agentToolMoneySchema.annotate({
    description:
      "Price the reservation page advertises for a booking on advertised_on, including any public sale: one cowork day without add-ons that cost extra, one meeting-room booking of the duration, or one office day with one seat.",
  }),
  discount: agentToolMoneySchema.annotate({
    description:
      "Public sale discount included in advertised_price; zero without one.",
  }),
  seat_price: Schema.optionalKey(agentToolMoneySchema),
  max_seats: Schema.optionalKey(Schema.Int),
  max_duration_hours: Schema.optionalKey(Schema.Int),
  add_ons: Schema.Array(
    Schema.Struct({
      id: Schema.Literals(["coffee", "workstation"]),
      name: Schema.String,
      price: agentToolMoneySchema,
      price_unit: Schema.Literal("day"),
      included: Schema.Boolean,
      options: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({
            id: Schema.Literals(workspaceProductMonitorOptions),
            name: Schema.String,
          })
        )
      ),
    })
  ),
  reservation_url: Schema.String,
});

export type AgentOffering = typeof agentOfferingSchema.Type;

export const listOfferingsResultSchema = Schema.Struct({
  business: Schema.Struct({
    name: Schema.String,
    address: Schema.String,
    opening_hours: Schema.String,
    booking: Schema.String,
  }),
  advertised_on: Schema.String.annotate({
    description: "Prague date (YYYY-MM-DD) the advertised prices are for.",
  }),
  offerings: Schema.Array(agentOfferingSchema),
});

export type ListOfferingsResult = typeof listOfferingsResultSchema.Type;
