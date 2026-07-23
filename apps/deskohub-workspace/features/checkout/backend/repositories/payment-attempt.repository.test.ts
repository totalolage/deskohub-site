import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  PaymentAttemptRepository,
  PaymentAttemptRepositoryLive,
} from "./payment-attempt.repository";

const unresolvedRecoveryMarkers = [
  "hold_creation_candidate:synthetic-epoch:synthetic-provider:1780308000000",
  "hold_creation_candidate:synthetic-epoch:synthetic-provider:1780308000000:1780308120000",
  "hold_creation_candidate_compensating:synthetic-epoch:synthetic-provider:1780308000000",
  "hold_creation_orphan_recovery:synthetic-epoch:synthetic-loser",
  "hold_creation_orphan_processing:synthetic-epoch:synthetic-loser:synthetic-owner",
] as const;

describe("PaymentAttemptRepository", () => {
  test("keeps a commit-ambiguous candidate non-payable until stabilization completes", async () => {
    const persistedAttempts: unknown[] = [];
    const epoch = "synthetic-stabilization-epoch";
    const reservation = {
      id: "synthetic-stabilization-reservation",
      reservationState: "held",
      paymentState: "not_started",
      activePaymentAttemptId: null as string | null,
      failureCode:
        "hold_creation_candidate:synthetic-stabilization-epoch:synthetic-provider:1780308000000" as
          | string
          | null,
    };
    const transaction = (workflow: (tx: unknown) => Effect.Effect<unknown>) =>
      Effect.gen(function* () {
        const stagedAttempts = [...persistedAttempts];
        const stagedReservation = { ...reservation };
        const tx = {
          insert: () => ({
            values: (values: Record<string, unknown>) => ({
              returning: () =>
                Effect.sync(() => {
                  const attempt = {
                    ...values,
                    id: `synthetic-attempt-${stagedAttempts.length + 1}`,
                    provider: "nexi",
                    state: "created",
                    securityToken: null,
                    providerRedirectUrl: null,
                    lastWebhookEventId: null,
                    lastProviderOperationId: null,
                    lastProviderStatus: null,
                    failureCode: null,
                    createdAt: Temporal.Instant.from("2026-06-01T10:00:00Z"),
                    updatedAt: Temporal.Instant.from("2026-06-01T10:00:00Z"),
                  };
                  stagedAttempts.push(attempt);
                  return [attempt];
                }),
            }),
          }),
          update: () => ({
            set: (values: Record<string, unknown>) => ({
              where: () => ({
                returning: () =>
                  Effect.sync(() => {
                    if (
                      stagedReservation.failureCode?.startsWith(
                        "hold_creation_candidate:"
                      )
                    ) {
                      return [];
                    }
                    Object.assign(stagedReservation, values);
                    return [{ id: stagedReservation.id }];
                  }),
              }),
            }),
          }),
        };

        const result = yield* workflow(tx);
        persistedAttempts.splice(
          0,
          persistedAttempts.length,
          ...stagedAttempts
        );
        Object.assign(reservation, stagedReservation);
        return result;
      });
    const create = () =>
      Effect.gen(function* () {
        const repository = yield* PaymentAttemptRepository;
        return yield* repository.create({
          workspaceReservationId: reservation.id,
          providerOrderId: "synthetic-provider-order",
          amountValue: 1000,
          amountExponent: 2,
          currency: "CZK",
        });
      }).pipe(
        Effect.provide(
          PaymentAttemptRepositoryLive.pipe(
            Layer.provide(
              Layer.succeed(WorkspaceDatabase, {
                db: { transaction } as never,
              })
            )
          )
        )
      );

    await expect(create().pipe(Effect.runPromise)).rejects.toBeDefined();
    expect(persistedAttempts).toEqual([]);
    expect(reservation.paymentState).toBe("not_started");

    reservation.failureCode = `hold_creation_attached:${epoch}`;
    await Effect.runPromise(create());

    expect(persistedAttempts).toHaveLength(1);
    expect(reservation.paymentState).toBe("pending");
    expect(reservation.activePaymentAttemptId).toBe("synthetic-attempt-1");
  });

  test.each(
    unresolvedRecoveryMarkers
  )("rolls back a staged attempt when recovery commits before the atomic reservation link: %s", async (failureCode) => {
    const persistedAttempts: unknown[] = [];
    const reservation = {
      id: "synthetic-reservation",
      reservationState: "held",
      paymentState: "not_started",
      activePaymentAttemptId: null as string | null,
      failureCode: null as string | null,
    };
    const transaction = (workflow: (tx: unknown) => Effect.Effect<unknown>) =>
      Effect.gen(function* () {
        const stagedAttempts = [...persistedAttempts];
        const stagedReservation = { ...reservation };
        const tx = {
          insert: () => ({
            values: (values: Record<string, unknown>) => ({
              returning: () =>
                Effect.sync(() => {
                  const attempt = {
                    ...values,
                    id: "synthetic-staged-attempt",
                    provider: "nexi",
                    state: "created",
                    securityToken: null,
                    providerRedirectUrl: null,
                    lastWebhookEventId: null,
                    lastProviderOperationId: null,
                    lastProviderStatus: null,
                    failureCode: null,
                    createdAt: Temporal.Instant.from("2026-06-01T10:00:00Z"),
                    updatedAt: Temporal.Instant.from("2026-06-01T10:00:00Z"),
                  };
                  stagedAttempts.push(attempt);
                  reservation.failureCode = failureCode;
                  stagedReservation.failureCode = failureCode;
                  return [attempt];
                }),
            }),
          }),
          update: () => ({
            set: (values: Record<string, unknown>) => ({
              where: () => ({
                returning: () =>
                  Effect.sync(() => {
                    if (
                      [
                        "hold_creation_candidate:",
                        "hold_creation_candidate_compensating:",
                        "hold_creation_orphan_recovery:",
                        "hold_creation_orphan_processing:",
                      ].some((prefix) =>
                        stagedReservation.failureCode?.startsWith(prefix)
                      )
                    ) {
                      return [];
                    }
                    Object.assign(stagedReservation, values);
                    return [{ id: stagedReservation.id }];
                  }),
              }),
            }),
          }),
        };

        const result = yield* workflow(tx);
        persistedAttempts.splice(
          0,
          persistedAttempts.length,
          ...stagedAttempts
        );
        Object.assign(reservation, stagedReservation);
        return result;
      });
    const fakeDatabase = {
      transaction,
    };
    const create = Effect.gen(function* () {
      const repository = yield* PaymentAttemptRepository;
      return yield* repository.create({
        workspaceReservationId: reservation.id,
        providerOrderId: "synthetic-provider-order",
        amountValue: 1000,
        amountExponent: 2,
        currency: "CZK",
      });
    }).pipe(
      Effect.provide(
        PaymentAttemptRepositoryLive.pipe(
          Layer.provide(
            Layer.succeed(WorkspaceDatabase, {
              db: fakeDatabase as never,
            })
          )
        )
      )
    );

    const error = await create.pipe(Effect.flip, Effect.runPromise);

    expect(error).toMatchObject({
      _tag: "PaymentAttemptStateError",
      operation: "paymentAttempts.create",
    });
    expect(persistedAttempts).toEqual([]);
    expect(reservation).toMatchObject({
      reservationState: "held",
      paymentState: "not_started",
      activePaymentAttemptId: null,
      failureCode,
    });
  });
});
