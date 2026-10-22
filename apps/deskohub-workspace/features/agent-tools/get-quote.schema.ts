import { Schema } from "effect";
import { workspaceReservationKindSchema } from "@/features/reservation/reservation-kind";
import { agentToolMoneySchema } from "./agent-tool-money";

export const getQuoteResultSchema = Schema.Struct({
  family: workspaceReservationKindSchema,
  total: agentToolMoneySchema.annotate({
    description: "The price of the selection.",
  }),
  regular_price: agentToolMoneySchema,
  discount: agentToolMoneySchema.annotate({
    description: "Anonymous sale discount included in total; zero without one.",
  }),
  quoted_at: Schema.String,
  note: Schema.String,
  reservation_url: Schema.String,
});

export type GetQuoteResult = typeof getQuoteResultSchema.Type;
