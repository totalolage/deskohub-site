import { Schema } from "effect";
import { workspaceReservationKindSchema } from "@/features/reservation/reservation-kind";
import { agentToolMoneySchema } from "./agent-tool-money";

export const startReservationResultSchema = Schema.Struct({
  order_id: Schema.String.annotate({
    description: "The order ID; get_reservation_status reports on it.",
  }),
  pay_url: Schema.String.annotate({
    description:
      "The Pay page for the held order. Give it to the customer, who checks the order, accepts the terms, and pays there.",
  }),
  pay_url_expires_at: Schema.String.annotate({
    description:
      "When the Pay link expires, as an ISO 8601 instant, together with the hold. After it, call start_reservation again with the same selection for a new hold.",
  }),
  family: workspaceReservationKindSchema,
  total: agentToolMoneySchema.annotate({
    description:
      "The price quoted for the selection; the Pay page shows the confirmed price.",
  }),
  price_changed: Schema.Boolean.annotate({
    description:
      "Whether the price changed since the quote; the Pay page shows the new price.",
  }),
  note: Schema.String,
});

export type StartReservationResult = typeof startReservationResultSchema.Type;
