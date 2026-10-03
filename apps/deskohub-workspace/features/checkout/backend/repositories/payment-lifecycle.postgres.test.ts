import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { NexiOrderIdSchema } from "@deskohub/nexi";
import { Effect, Layer, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { makeDatabaseClient } from "@/db/database-client";
import { makeAccountingDocumentSnapshot } from "@/features/accounting/accounting-document-snapshot";
import { getReservationQuoteFingerprint } from "@/features/checkout/reservation-quote-fingerprint";
import { getMeetingRoomReservationQuote } from "@/features/checkout/reservation-quote-meeting-room";
import { calculateDiscounts } from "@/features/discounts/calculator";
import { makeDiscountCommitment } from "@/features/discounts/commitment";
import { discountIdSchema } from "@/features/discounts/contracts";
import { deriveOpaqueDiscountId } from "@/features/discounts/opaque-discount-id";
import {
  discountCodeIdSchema,
  storedDiscountIdSchema,
} from "@/features/discounts/persistence-contracts";
import { normalizedMeetingRoomReservationOrderSchema } from "@/features/reservation/meeting-room-reservation";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { startLocalPostgres } from "@/shared/testing/local-postgres";
import { PaymentLifecycleRepository } from "./payment-lifecycle.repository";

describe.skipIf(process.env.WORKSPACE_LOCAL_POSTGRES_TESTS !== "1")(
  "payment service-date admission in PostgreSQL",
  () => {
    let database: Awaited<ReturnType<typeof startLocalPostgres>>;
    beforeAll(async () => {
      database = await startLocalPostgres();
    }, 60000);
    afterAll(async () => {
      await database?.stop();
    });

    const makeFixture = async (internal: boolean) => {
      const reservationId = workspaceReservationIdSchema.make(
        crypto.randomUUID()
      );
      const codeId = discountCodeIdSchema.make(crypto.randomUUID());
      const discountId = storedDiscountIdSchema.make(crypto.randomUUID());
      const promotionId = crypto.randomUUID();
      const customerId = DotyposCustomerIdSchema.make("synthetic-customer");
      const dotyposReservationId = DotyposReservationIdSchema.make(
        `synthetic-${reservationId}`
      );
      const basisPoints = internal ? 10000 : 1000;
      await database.pool.query(
        "INSERT INTO discounts (id, labels, percentage_basis_points) VALUES ($1, $2, $3)",
        [
          discountId,
          JSON.stringify({ "cs-CZ": "Test", "en-US": "Test" }),
          basisPoints,
        ]
      );
      await database.pool.query(
        "INSERT INTO discount_targets (discount_id, product_target) VALUES ($1, $2)",
        [discountId, JSON.stringify({ kind: "meeting-room" })]
      );
      await database.pool.query(
        "INSERT INTO promotion_codes (id, kind, code, enabled) VALUES ($1, 'discount', $2, true)",
        [promotionId, `TEST-${codeId.toUpperCase()}`]
      );
      await database.pool.query(
        "INSERT INTO discount_codes (id, promotion_code_id, code, enabled, discount_id, service_date_from, service_date_until) VALUES ($1, $2, $3, true, $4, '2099-09-21', '2099-09-22')",
        [codeId, promotionId, `TEST-${codeId.toUpperCase()}`, discountId]
      );
      await database.pool.query(
        "INSERT INTO workspace_reservations (id, checkout_attempt_key, dotypos_customer_id, dotypos_reservation_id, reservation_state, payment_state, fulfillment_state, reservation_details, locale, reservation_hold_expires_at) VALUES ($1, $1, $2, $3, 'held', 'not_started', 'not_started', '{}', 'en-US', now() + interval '1 hour')",
        [reservationId, customerId, dotyposReservationId]
      );
      // Starts at 00:30 Prague on Sep 21, but Sep 20 in UTC; ends the following day.
      const reservation = Schema.decodeUnknownSync(
        normalizedMeetingRoomReservationOrderSchema
      )({
        kind: "meeting-room",
        duration: { unit: "day", amount: 1 },
        reservationDate: "2099-09-21",
        startsAt: "2099-09-20T22:30:00Z",
        endsAt: "2099-09-21T22:30:00Z",
        name: "Synthetic Customer",
        email: "discount-test@example.test",
        phone: "+420 700 000 000",
      });
      const product = {
        kind: "meeting-room",
        duration: reservation.duration,
      } as const;
      const base = Effect.runSync(getMeetingRoomReservationQuote(reservation));
      const calculation = Effect.runSync(
        calculateDiscounts({
          product,
          discountableSubtotal: base.payment.expectedPrice,
          candidates: [
            {
              discount: {
                id: discountIdSchema.make(
                  deriveOpaqueDiscountId("discount-code", codeId)
                ),
                label: "Test",
                adjustment: { kind: "percentage", basisPoints },
              },
              provenance: {
                providerNamespace: "discount-code",
                providerReference: codeId,
              },
              claim: {
                kind: "discount_code",
                codeId,
                storedDiscountId: discountId,
                dotyposCustomerId: customerId,
                product,
              },
            },
          ],
        })
      );
      const quote = Effect.runSync(
        getMeetingRoomReservationQuote(reservation, {
          discountQuote: calculation.quote,
        })
      );
      const snapshot = makeAccountingDocumentSnapshot({
        workspaceReservationId: reservationId,
        dotyposCustomerId: customerId,
        dotyposReservationId,
        locale: "en-US",
        prepared: {
          kind: "meeting-room",
          reservation,
          quote: {
            ...quote,
            fingerprint: getReservationQuoteFingerprint(reservation, quote),
          },
        },
      });
      const admit = (date = "2099-09-21") =>
        Effect.gen(function* () {
          const repository = yield* PaymentLifecycleRepository;
          const input = {
            workspaceReservationId: reservationId,
            amount: quote.payment.expectedPrice,
            locale: "en-US" as const,
            accountingSnapshot: snapshot,
            commitment: makeDiscountCommitment({
              product,
              reservationDate: date,
              applications: calculation.applications,
            }),
          };
          return internal
            ? yield* repository.completeInternalPayment(input)
            : yield* repository.createPendingNexiAttempt({
                ...input,
                providerOrderId: NexiOrderIdSchema.make(crypto.randomUUID()),
              });
        }).pipe(
          Effect.provide(
            PaymentLifecycleRepository.Default.pipe(
              Layer.provide(
                Layer.effect(
                  WorkspaceDatabase,
                  makeDatabaseClient(database.pool).pipe(
                    Effect.map((db) => ({ db }))
                  )
                )
              )
            )
          ),
          Effect.result,
          Effect.runPromise
        );
      const persisted = async () => {
        const result = await database.pool.query(
          `SELECT reservation_state, payment_state, active_payment_attempt_id,
        (SELECT count(*)::int FROM payment_attempts WHERE workspace_reservation_id = $1) attempts,
        (SELECT count(*)::int FROM accounting_document_snapshots WHERE workspace_reservation_id = $1) snapshots,
        (SELECT count(*)::int FROM discount_applications WHERE workspace_reservation_id = $1) applications,
        (SELECT count(*)::int FROM discount_code_redemptions WHERE code_id = $2) claims
        FROM workspace_reservations WHERE id = $1`,
          [reservationId, codeId]
        );
        return result.rows[0];
      };
      return { admit, persisted, codeId };
    };

    for (const internal of [false, true]) {
      const provider = internal ? "internal" : "Nexi";
      test(`${provider}: stale service-date configuration rolls back the entire admission`, async () => {
        const fixture = await makeFixture(internal);
        const before = await fixture.persisted();
        await database.pool.query(
          "UPDATE discount_codes SET service_date_from = '2099-09-22', service_date_until = '2099-09-23' WHERE id = $1",
          [fixture.codeId]
        );
        expect(await fixture.admit()).toMatchObject({
          _tag: "Failure",
          failure: {
            _tag: "DiscountClaimError",
            reason: "service_date_ineligible",
          },
        });
        expect(await fixture.persisted()).toEqual(before);
        expect(before).toMatchObject({
          payment_state: "not_started",
          active_payment_attempt_id: null,
          attempts: 0,
          snapshots: 0,
          applications: 0,
          claims: 0,
        });
      });
      test(`${provider}: a mismatched commitment date leaves no writes`, async () => {
        const fixture = await makeFixture(internal);
        const before = await fixture.persisted();
        expect(await fixture.admit("2099-09-20")).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "DiscountClaimError", reason: "claim_conflict" },
        });
        expect(await fixture.persisted()).toEqual(before);
      });
      test(`${provider}: eligible local start date admits an overnight booking`, async () => {
        const fixture = await makeFixture(internal);
        expect(await fixture.admit()).toMatchObject({ _tag: "Success" });
        expect(await fixture.persisted()).toMatchObject({
          attempts: 1,
          snapshots: 1,
          applications: 1,
          claims: 1,
          payment_state: internal ? "paid" : "pending",
        });
      });
      test(`${provider}: a legacy unrestricted code still admits`, async () => {
        const fixture = await makeFixture(internal);
        await database.pool.query(
          "UPDATE discount_codes SET service_date_from = null, service_date_until = null WHERE id = $1",
          [fixture.codeId]
        );
        expect(await fixture.admit()).toMatchObject({ _tag: "Success" });
      });
    }
  }
);
