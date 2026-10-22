import { Effect, Match, Schema } from "effect";
import {
  CustomerAccountContactService,
  type CustomerReservationHistory,
  CustomerReservationHistoryService,
  type CustomerReservationParty,
  type CustomerReservationSummary,
} from "@/features/account";
import { workspaceCoworkTiers } from "@/features/checkout/product-catalog";
import { agentToolLocaleField, defineSignedInAgentTool } from "./agent-tool";
import { AgentToolError } from "./agent-tool-error";
import { CurrentCustomerAgentGrant } from "./customer-agent-caller";

const inputSchema = Schema.Struct({ locale: agentToolLocaleField });

const reservationSchema = Schema.Struct({
  order_id: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "The order ID for get_reservation_status; absent for reservations not booked on the website.",
    })
  ),
  family: Schema.Literals(["cowork", "meeting-room", "office", "other"]),
  tier: Schema.optionalKey(Schema.Literals(workspaceCoworkTiers)),
  starts_at: Schema.NullOr(Schema.String),
  ends_at: Schema.NullOr(Schema.String),
  seats: Schema.NullOr(Schema.Finite),
  status: Schema.Literals([
    "cancelled",
    "confirmed",
    "pending",
    "requires-attention",
  ]),
  party: Schema.Literals([
    "own",
    "booked_for_other",
    "booked_by_other",
  ]).annotate({
    description:
      "own: the customer booked it for themselves. booked_for_other: the customer booked it for someone else. booked_by_other: someone else booked it for the customer.",
  }),
});

const outputSchema = Schema.Struct({
  current: Schema.Array(reservationSchema),
  past: Schema.Array(reservationSchema),
  unavailable: Schema.Array(reservationSchema).annotate({
    description: "Reservations whose details can't be shown right now.",
  }),
});

type ListMyReservationsResult = typeof outputSchema.Type;

export const listMyReservationsTool = defineSignedInAgentTool({
  name: "list_my_reservations",
  title: "List my Deskohub Workspace reservations",
  description:
    "Lists the signed-in customer's reservations as their account page shows them: current and past, with family, time, seats, and status. Other people's names and contact details are never included.",
  scope: "reservations:read",
  readOnly: true,
  unavailableCode: "reservations_unavailable",
  input: inputSchema,
  output: outputSchema,
  run: Effect.fn("agentTools.listMyReservations")(() =>
    Effect.Do.pipe(
      Effect.bind("account", () => readHistoryAccount),
      Effect.bind("history", ({ account }) =>
        CustomerReservationHistoryService.pipe(
          // The tool never returns names, so it skips their uncached read.
          Effect.flatMap((histories) =>
            histories.load(account, { includePartyNames: false })
          ),
          Effect.mapError(
            AgentToolError.unavailable("reservations_unavailable")
          )
        )
      ),
      Effect.flatMap(({ history }) => toListResult(history))
    )
  ),
});

/**
 * The account whose history is listed: with its linked Dotypos customer
 * once it has one, otherwise only the reservations it authored. Reading the
 * link never claims one.
 */
const readHistoryAccount = Effect.all({
  grant: CurrentCustomerAgentGrant,
  linked: CustomerAccountContactService.pipe(
    Effect.flatMap((contacts) => contacts.currentLinkedAccount),
    Effect.mapError(AgentToolError.refused("account_unavailable"))
  ),
}).pipe(
  Effect.map(({ grant, linked }) => linked ?? { accountId: grant.accountId })
);

const toListResult = (
  history: CustomerReservationHistory
): Effect.Effect<ListMyReservationsResult, AgentToolError> =>
  Match.value(history).pipe(
    Match.discriminatorsExhaustive("kind")({
      available: ({ groups }) =>
        Effect.succeed({
          current: groups.current.map(toReservation),
          past: groups.past.map(toReservation),
          unavailable: groups.unavailable.map(toReservation),
        }),
      unavailable: ({ reason }) =>
        Effect.fail(
          Match.value(reason).pipe(
            Match.when("provider-unavailable", () =>
              AgentToolError.unavailable("reservations_unavailable")(reason)
            ),
            Match.when("email-unverified", () =>
              AgentToolError.refused("account_unavailable")()
            ),
            Match.when("link-required", () =>
              AgentToolError.refused("profile_incomplete")()
            ),
            Match.exhaustive
          )
        ),
    })
  );

const toReservation = (
  reservation: CustomerReservationSummary
): ListMyReservationsResult["current"][number] => ({
  ...(reservation.workspaceReservationId && {
    order_id: reservation.workspaceReservationId,
  }),
  family: reservation.product.kind,
  ...(reservation.product.kind === "cowork" && {
    tier: reservation.product.tier,
  }),
  starts_at: reservation.startsAt,
  ends_at: reservation.endsAt,
  seats: reservation.seats,
  status: reservation.status,
  party: toParty(reservation.party),
});

const toParty = (party: CustomerReservationParty | undefined) =>
  party
    ? Match.value(party).pipe(
        Match.discriminatorsExhaustive("kind")({
          "booked-for": () => "booked_for_other" as const,
          "booked-by": () => "booked_by_other" as const,
          "booked-by-deleted-account": () => "booked_by_other" as const,
        })
      )
    : ("own" as const);
