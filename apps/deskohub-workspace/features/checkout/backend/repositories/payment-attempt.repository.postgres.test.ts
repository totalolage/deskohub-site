import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { NexiOrderIdSchema } from "@deskohub/nexi";
import { Effect } from "effect";
import type { PaymentAttemptState, PaymentState } from "@/db/schema";
import { paymentAttempts } from "@/db/schema";
import {
  type PaymentAttemptId,
  paymentAttemptIdSchema,
} from "@/features/checkout/checkout-identifiers";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  isNexiPaymentAttempt,
  PaymentAttemptRepository,
} from "./payment-attempt.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)(
  "PaymentAttemptRepository on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const reservationIds: WorkspaceReservationId[] = [];

    afterAll(async () => {
      await testDatabase.pool.query(
        "delete from payment_attempts where workspace_reservation_id = any($1)",
        [reservationIds]
      );
      await testDatabase.pool.query(
        "delete from workspace_reservations where id = any($1)",
        [reservationIds]
      );
    });

    const run = <A, E>(
      operation: (
        repository: typeof PaymentAttemptRepository.Service
      ) => Effect.Effect<A, E>
    ) =>
      Effect.runPromise(
        Effect.gen(function* () {
          return yield* operation(yield* PaymentAttemptRepository);
        }).pipe(
          Effect.provide(PaymentAttemptRepository.Default),
          Effect.provide(testDatabase.layer)
        )
      );

    const insertReservation = async () => {
      const { id } = await Effect.runPromise(
        workspaceFixtures(testDatabase.db).reservation({
          stage: { reservation: "held" },
        })
      );
      reservationIds.push(id);
      return id;
    };

    const insertAttempt = async (input: {
      readonly workspaceReservationId: WorkspaceReservationId;
      readonly state: PaymentAttemptState;
      readonly provider?: "nexi" | "internal";
      readonly updatedAt?: Temporal.Instant;
    }) => {
      const id = paymentAttemptIdSchema.make(
        `attempt-display-${crypto.randomUUID()}`
      );
      const provider = input.provider ?? "nexi";
      await Effect.runPromise(
        testDatabase.db.insert(paymentAttempts).values({
          id,
          workspaceReservationId: input.workspaceReservationId,
          provider,
          providerOrderId:
            provider === "nexi"
              ? NexiOrderIdSchema.make(`order-${crypto.randomUUID()}`)
              : null,
          state: input.state,
          ...(["failed", "cancelled", "expired"].includes(input.state) && {
            failureCode: "attempt_display_test",
          }),
          amountValue: provider === "nexi" ? 29_000 : 0,
          amountExponent: 2,
          currency: "CZK",
          ...(input.updatedAt && { updatedAt: input.updatedAt }),
        })
      );
      return id;
    };

    const findDisplayable = (input: {
      readonly workspaceReservationId: WorkspaceReservationId;
      readonly activePaymentAttemptId?: PaymentAttemptId;
      readonly paymentState: PaymentState;
    }) =>
      run((repository) => repository.findDisplayableForReservation(input)).then(
        (attempt) => attempt?.id ?? null
      );

    test("finds an attempt by id and by Nexi order with its amount as money", async () => {
      const workspaceReservationId = await insertReservation();
      const id = await insertAttempt({
        workspaceReservationId,
        state: "pending",
      });

      const byId = await run((repository) => repository.findById(id));
      expect(byId?.amount).toEqual({
        value: 29_000,
        exponent: 2,
        currency: "CZK",
      });
      expect(byId && isNexiPaymentAttempt(byId)).toBe(true);
      expect(byId).not.toHaveProperty("amountValue");

      const byOrder = await run((repository) =>
        repository.findByProviderOrderId(byId!.providerOrderId!)
      );
      expect(byOrder?.id).toBe(id);
    });

    test("finds nothing for an unknown id or Nexi order", async () => {
      expect(
        await run((repository) =>
          repository.findById(
            paymentAttemptIdSchema.make(`missing-${crypto.randomUUID()}`)
          )
        )
      ).toBeNull();
      expect(
        await run((repository) =>
          repository.findByProviderOrderId(
            NexiOrderIdSchema.make(`missing-${crypto.randomUUID()}`)
          )
        )
      ).toBeNull();
    });

    test("an internal attempt is not a Nexi attempt", async () => {
      const workspaceReservationId = await insertReservation();
      const id = await insertAttempt({
        workspaceReservationId,
        state: "paid",
        provider: "internal",
      });

      const attempt = await run((repository) => repository.findById(id));
      expect(attempt?.amount.value).toBe(0);
      expect(attempt && isNexiPaymentAttempt(attempt)).toBe(false);
    });

    test("shows the active attempt while it is created, pending, or paid", async () => {
      for (const state of ["created", "pending", "paid"] as const) {
        const workspaceReservationId = await insertReservation();
        const active = await insertAttempt({ workspaceReservationId, state });

        expect(
          await findDisplayable({
            workspaceReservationId,
            activePaymentAttemptId: active,
            paymentState: "pending",
          })
        ).toBe(active);
      }
    });

    test("shows no attempt for a terminal active attempt on an unpaid reservation", async () => {
      const workspaceReservationId = await insertReservation();
      const active = await insertAttempt({
        workspaceReservationId,
        state: "expired",
      });
      await insertAttempt({ workspaceReservationId, state: "pending" });

      expect(
        await findDisplayable({
          workspaceReservationId,
          activePaymentAttemptId: active,
          paymentState: "expired",
        })
      ).toBeNull();
    });

    test("shows no attempt without an active attempt on an unpaid reservation", async () => {
      const workspaceReservationId = await insertReservation();
      await insertAttempt({ workspaceReservationId, state: "pending" });

      expect(
        await findDisplayable({
          workspaceReservationId,
          paymentState: "pending",
        })
      ).toBeNull();
    });

    test("a paid reservation without an active attempt shows its latest paid attempt", async () => {
      const workspaceReservationId = await insertReservation();
      const now = Temporal.Now.instant();
      await insertAttempt({
        workspaceReservationId,
        state: "paid",
        updatedAt: now.subtract({ minutes: 5 }),
      });
      const latestPaid = await insertAttempt({
        workspaceReservationId,
        state: "paid",
        updatedAt: now,
      });
      await insertAttempt({ workspaceReservationId, state: "pending" });

      expect(
        await findDisplayable({ workspaceReservationId, paymentState: "paid" })
      ).toBe(latestPaid);
    });

    test("a paid reservation prefers its active attempt over a newer paid one", async () => {
      const workspaceReservationId = await insertReservation();
      const now = Temporal.Now.instant();
      const active = await insertAttempt({
        workspaceReservationId,
        state: "pending",
        updatedAt: now.subtract({ minutes: 5 }),
      });
      await insertAttempt({
        workspaceReservationId,
        state: "paid",
        updatedAt: now,
      });

      expect(
        await findDisplayable({
          workspaceReservationId,
          activePaymentAttemptId: active,
          paymentState: "paid",
        })
      ).toBe(active);
    });

    test("never shows another reservation's attempt", async () => {
      const workspaceReservationId = await insertReservation();
      const otherReservationId = await insertReservation();
      const otherAttempt = await insertAttempt({
        workspaceReservationId: otherReservationId,
        state: "paid",
      });

      expect(
        await findDisplayable({
          workspaceReservationId,
          activePaymentAttemptId: otherAttempt,
          paymentState: "paid",
        })
      ).toBeNull();
    });
  }
);
