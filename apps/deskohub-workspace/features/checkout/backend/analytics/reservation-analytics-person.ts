import "server-only";

import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer, Option } from "effect";
import type { CustomerAccountId } from "@/features/account/customer-account";
import {
  AnalyticsConsentLedger,
  type AnalyticsConsentUnavailable,
} from "@/features/legal/backend/analytics-consent-ledger";
import type { WorkspaceReservationDetailsMalformedError } from "@/features/reservation/backend/stored-reservation-details.server";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";

export interface IReservationAnalyticsPerson {
  /**
   * The account whose PostHog person the reservation's lifecycle events
   * join: its author, while the author's current analytics consent decision
   * is a grant, whichever privacy notice it was given under. None when the
   * author withdrew or never decided, or the reservation isn't stored.
   */
  readonly linkedAccount: (
    reservationId: WorkspaceReservationId
  ) => Effect.Effect<
    Option.Option<CustomerAccountId>,
    | AnalyticsConsentUnavailable
    | EffectDrizzleQueryError
    | WorkspaceReservationDetailsMalformedError
  >;
}

/**
 * Who a reservation's lifecycle events are about in PostHog, read from the
 * stored author and the ledger, so it needs no session and holds for
 * webhooks and scheduled work too.
 */
export class ReservationAnalyticsPerson extends Context.Service<
  ReservationAnalyticsPerson,
  IReservationAnalyticsPerson
>()("@deskohub-workspace/checkout/ReservationAnalyticsPerson") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const reservations = yield* WorkspaceReservationRepository;
      const ledger = yield* AnalyticsConsentLedger;

      return {
        linkedAccount: Effect.fn("ReservationAnalyticsPerson.linkedAccount")(
          function* (reservationId) {
            const reservation = yield* reservations.findById(reservationId);
            if (!reservation) return Option.none();

            const author = reservation.authorAccountId;
            const decision = yield* ledger.currentDecision(author);
            return Option.exists(
              decision,
              ({ decision }) => decision === "grant"
            )
              ? Option.some(author)
              : Option.none();
          }
        ),
      } satisfies IReservationAnalyticsPerson;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        WorkspaceReservationRepository.Live,
        AnalyticsConsentLedger.Live
      )
    )
  );
}
