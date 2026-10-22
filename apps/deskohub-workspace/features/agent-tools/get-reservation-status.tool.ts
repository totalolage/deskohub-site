import { Effect, Match, Option, Schema } from "effect";
import { fulfillmentStates, paymentStates } from "@/db/schema";
import {
  CheckoutStatusService,
  type CheckoutStatusViewModel,
} from "@/features/checkout/backend/checkout/checkout-status.service";
import type { Locale } from "@/features/i18n";
import { ReservationAuthorizationService } from "@/features/reservation/backend/reservation-authorization.service";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { workspaceReservationKindSchema } from "@/features/reservation/reservation-kind";
import { reservationStatusPath } from "@/features/reservation/routes";
import { getWorkspaceRuntimeCallbackOrigin } from "@/shared/backend/config/workspace-url.config";
import {
  agentToolLocaleField,
  defineSignedInAgentTool,
  getAgentToolLocale,
} from "./agent-tool";
import { AgentToolError } from "./agent-tool-error";
import { agentToolMoneySchema, toAgentToolMoney } from "./agent-tool-money";

const inputSchema = Schema.Struct({
  order_id: workspaceReservationIdSchema.annotate({
    description:
      "The order ID from list_my_reservations, or from a start_reservation result that has one.",
  }),
  locale: agentToolLocaleField,
});

/** Every status an order can report, as on its status page. */
const reservationStatuses = [
  "created",
  "pending",
  "payment_pending_delayed",
  "paid_waiting_fulfillment",
  "paid_fulfillment_delayed",
  "paid_awaiting_delivery",
  "paid_delivery_delayed",
  "fulfilled",
  "fulfillment_failed",
  "payment_failed",
  "cancelled",
  "expired",
  "late_payment_checking",
  "late_payment_refund",
  "late_payment_review",
] as const;

const outputSchema = Schema.Struct({
  order_id: Schema.String,
  family: workspaceReservationKindSchema,
  status: Schema.Literals(reservationStatuses).annotate({
    description:
      "created: held, not paid yet. pending: payment in progress. paid_*: paid and being confirmed. fulfilled: confirmed. payment_failed, cancelled, expired: not booked. late_payment_*: a payment after the hold expired is being checked or refunded.",
  }),
  payment_status: Schema.Literals(paymentStates),
  fulfillment_status: Schema.Literals(fulfillmentStates),
  starts_at: Schema.optionalKey(
    Schema.String.annotate({ description: "Start, as an ISO 8601 instant." })
  ),
  ends_at: Schema.optionalKey(
    Schema.String.annotate({ description: "End, as an ISO 8601 instant." })
  ),
  total: Schema.optionalKey(agentToolMoneySchema),
  status_url: Schema.String.annotate({
    description:
      "The order's status page on the website, where the signed-in customer sees the full details.",
  }),
});

type ReservationStatusResult = typeof outputSchema.Type;

export const getReservationStatusTool = defineSignedInAgentTool({
  name: "get_reservation_status",
  title: "Check a Deskohub Workspace reservation",
  description:
    "Reports the status of one of the signed-in customer's own orders, such as confirmed, cancelled, or expired, with its time and price. It never returns door codes or contact details; the customer finds those on the status page.",
  scope: "reservations:read",
  readOnly: true,
  unavailableCode: "reservations_unavailable",
  input: inputSchema,
  output: outputSchema,
  run: Effect.fn("agentTools.getReservationStatus")((input) =>
    Effect.succeed({ orderId: input.order_id }).pipe(
      Effect.let("locale", () => getAgentToolLocale(input)),
      Effect.tap(({ orderId, locale }) => ensureOwnOrder({ orderId, locale })),
      Effect.bind("status", ({ orderId }) =>
        CheckoutStatusService.pipe(
          Effect.flatMap((statuses) =>
            // The tool never returns contact details, so it skips their
            // uncached Dotypos read.
            statuses.getStatus({
              orderId,
              returnOutcome: "unknown",
              includeSupportContact: false,
            })
          ),
          Effect.mapError(
            AgentToolError.unavailable("reservations_unavailable")
          )
        )
      ),
      Effect.bind("origin", () =>
        getWorkspaceRuntimeCallbackOrigin.pipe(
          Effect.mapError(
            AgentToolError.unavailable("reservations_unavailable")
          )
        )
      ),
      Effect.flatMap(toReservationStatusResult)
    )
  ),
});

/**
 * Only the order's author or its customer may see it; any other order is
 * refused exactly like one that doesn't exist.
 */
const ensureOwnOrder = (input: {
  readonly orderId: WorkspaceReservationId;
  readonly locale: Locale;
}) =>
  ReservationAuthorizationService.pipe(
    Effect.flatMap((authorization) =>
      authorization.isAuthorized({ ...input, permission: "view-status" })
    ),
    Effect.filterOrFail(
      (authorized) => authorized,
      () => AgentToolError.refused("reservation_not_found")()
    ),
    Effect.asVoid,
    Effect.provide(ReservationAuthorizationService.Default)
  );

const toReservationStatusResult = ({
  orderId,
  status,
  origin,
}: {
  readonly orderId: WorkspaceReservationId;
  readonly status: CheckoutStatusViewModel;
  readonly origin: URL;
}): Effect.Effect<ReservationStatusResult, AgentToolError> =>
  Match.value(status).pipe(
    Match.when({ status: "not_found" }, () =>
      Effect.fail(AgentToolError.refused("reservation_not_found")())
    ),
    Match.orElse((reservation) =>
      Effect.succeed({
        order_id: orderId,
        family: reservation.kind,
        status: reservation.status,
        payment_status: reservation.paymentStatus,
        fulfillment_status: reservation.fulfillmentStatus,
        ...Option.match(Option.fromNullishOr(reservation.summary), {
          onNone: () => ({}),
          onSome: (summary) => ({
            starts_at: summary.reservedFrom.toString(),
            ends_at: summary.reservedUntil.toString(),
            total: toAgentToolMoney(summary.price),
          }),
        }),
        status_url: new URL(
          `${reservationStatusPath}/${encodeURIComponent(orderId)}`,
          origin
        ).toString(),
      })
    )
  );
