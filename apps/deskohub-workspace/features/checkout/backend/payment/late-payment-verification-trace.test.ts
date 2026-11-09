import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { NexiService, type PaymentVerificationResult } from "@deskohub/nexi";
import { Cause, type Duration, Effect, Exit, Layer, Predicate } from "effect";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import {
  type EffectTrace,
  recordEffectTrace,
  startEffectTrace,
} from "@/shared/testing/effect-trace.test-utils";
import { LatePaymentRecoveryRepository } from "../repositories/late-payment-recovery.repository";
import { PaymentAttemptRepository } from "../repositories/payment-attempt.repository";
import { LatePaymentRecoveryQueueService } from "./late-payment-recovery-queue.service";
import { LatePaymentVerificationService } from "./late-payment-verification.service";

type Methods = Record<
  string,
  (...args: never[]) => Effect.Effect<unknown, unknown>
>;

interface Collaborators {
  readonly reservations?: Methods;
  readonly paymentAttempts?: Methods;
  readonly recoveries?: Methods;
  readonly recoveryQueue?: Methods;
  readonly nexi?: Methods;
}

const expiredReservation = {
  id: "reservation-id",
  correlationId: "correlation-id",
  paymentState: "expired",
  activePaymentAttemptId: "attempt-id",
};

const expiredAttempt = {
  id: "attempt-id",
  workspaceReservationId: "reservation-id",
  provider: "nexi",
  providerOrderId: "provider-order-id",
  state: "expired",
  amount: { value: 29_000, exponent: 2, currency: "CZK" },
  securityToken: "security-token",
};

const verification = (
  status: PaymentVerificationResult["status"],
  mismatches: PaymentVerificationResult["mismatches"] = []
): PaymentVerificationResult => ({
  status,
  provider: {
    orderId: "provider-order-id",
    operationId: "operation-id",
    operationCount: 1,
    amount: "29000",
    currency: "CZK",
    orderStatus: status === "success" ? "EXECUTED" : "DECLINED",
    captureExecuted: status === "success",
  },
  mismatches,
});

const succeed =
  <A>(value: A) =>
  () =>
    Effect.succeed(value as never);
const fail =
  <E>(error: E) =>
  () =>
    Effect.fail(error as never);

const minutesAgo = (minutes: number) =>
  Temporal.Now.instant().subtract({ minutes });

/** Collaborators of a verification that reaches Nexi and starts recovery. */
const settledCollaborators = (
  overrides: Collaborators = {}
): Collaborators => ({
  ...overrides,
  reservations: {
    findById: succeed(expiredReservation),
    ...overrides.reservations,
  },
  paymentAttempts: {
    findById: succeed(expiredAttempt),
    ...overrides.paymentAttempts,
  },
  recoveries: {
    findByPaymentAttemptId: succeed(null),
    start: succeed({}),
    ...overrides.recoveries,
  },
  recoveryQueue: {
    enqueue: succeed(undefined),
    ...overrides.recoveryQueue,
  },
  nexi: {
    verifyPaymentOutcome: succeed(verification("success")),
    ...overrides.nexi,
  },
});

/** The success value, or the failure's message. */
const outcomeOf = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  const failure = Cause.squash(exit.cause);
  return Predicate.hasProperty(failure, "message") ? failure.message : failure;
};

const startRecoveryIfSettled = async (
  collaborators: Collaborators,
  input: { readonly verificationDeadline?: Duration.Input } = {}
) => {
  const trace: EffectTrace = startEffectTrace();
  const record = (service: string, methods: Methods | undefined) =>
    trace.recordCalls(service, methods ?? {});
  const exit = await Effect.gen(function* () {
    const service = yield* LatePaymentVerificationService;
    return yield* recordEffectTrace(
      trace,
      service.startRecoveryIfSettled({
        orderId: "reservation-id" as never,
        ...input,
      })
    );
  }).pipe(
    Effect.provide(
      LatePaymentVerificationService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(
              WorkspaceReservationRepository,
              record("reservations", collaborators.reservations)
            ),
            Layer.mock(
              PaymentAttemptRepository,
              record("paymentAttempts", collaborators.paymentAttempts)
            ),
            Layer.mock(
              LatePaymentRecoveryRepository,
              record("recoveries", collaborators.recoveries)
            ),
            Layer.mock(
              LatePaymentRecoveryQueueService,
              record("recoveryQueue", collaborators.recoveryQueue)
            ),
            Layer.mock(NexiService, record("nexi", collaborators.nexi))
          )
        )
      )
    ),
    Effect.runPromise
  );
  return { outcome: outcomeOf(exit), trace: trace.entries };
};

describe("LatePaymentVerificationService.startRecoveryIfSettled trace", () => {
  test("reports not verifiable when the reservation can't be loaded", async () => {
    const { outcome, trace } = await startRecoveryIfSettled(
      settledCollaborators({
        reservations: { findById: fail(new Error("db down")) },
      })
    );

    expect(outcome).toBe("not_verifiable");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentVerification.startRecoveryIfSettled",
        "call reservations.findById(reservation-id)",
        "Error Late-payment verification failed (cause=<Error>) {orderId} in latePaymentVerification.startRecoveryIfSettled",
      ]
    `);
  });

  test("ignores a missing reservation", async () => {
    const { outcome, trace } = await startRecoveryIfSettled(
      settledCollaborators({ reservations: { findById: succeed(null) } })
    );

    expect(outcome).toBe("not_applicable");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentVerification.startRecoveryIfSettled",
        "call reservations.findById(reservation-id)",
      ]
    `);
  });

  test("ignores a reservation without an active payment attempt", async () => {
    const { outcome, trace } = await startRecoveryIfSettled(
      settledCollaborators({
        reservations: {
          findById: succeed({
            ...expiredReservation,
            activePaymentAttemptId: null,
          }),
        },
      })
    );

    expect(outcome).toBe("not_applicable");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentVerification.startRecoveryIfSettled",
        "call reservations.findById(reservation-id)",
      ]
    `);
  });

  test("ignores a reservation whose payment isn't terminal", async () => {
    const { outcome, trace } = await startRecoveryIfSettled(
      settledCollaborators({
        reservations: {
          findById: succeed({ ...expiredReservation, paymentState: "paid" }),
        },
      })
    );

    expect(outcome).toBe("not_applicable");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentVerification.startRecoveryIfSettled",
        "call reservations.findById(reservation-id)",
      ]
    `);
  });

  for (const paymentState of ["failed", "cancelled"]) {
    test(`verifies a ${paymentState} reservation`, async () => {
      const { outcome } = await startRecoveryIfSettled(
        settledCollaborators({
          reservations: {
            findById: succeed({ ...expiredReservation, paymentState }),
          },
          paymentAttempts: {
            findById: succeed({ ...expiredAttempt, state: paymentState }),
          },
        })
      );

      expect(outcome).toBe("recovery_started");
    });
  }

  test("re-enqueues a stalled pending recovery", async () => {
    const { outcome, trace } = await startRecoveryIfSettled(
      settledCollaborators({
        recoveries: {
          findByPaymentAttemptId: succeed({
            state: "pending",
            createdAt: minutesAgo(5),
          }),
        },
      })
    );

    expect(outcome).toBe("recovery_started");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentVerification.startRecoveryIfSettled",
        "call reservations.findById(reservation-id)",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveryQueue.enqueue(paymentAttemptId=attempt-id)",
      ]
    `);
  });

  test("leaves a recent pending recovery to its queue message", async () => {
    const { outcome, trace } = await startRecoveryIfSettled(
      settledCollaborators({
        recoveries: {
          findByPaymentAttemptId: succeed({
            state: "pending",
            createdAt: Temporal.Now.instant(),
          }),
        },
      })
    );

    expect(outcome).toBe("recovery_started");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentVerification.startRecoveryIfSettled",
        "call reservations.findById(reservation-id)",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
      ]
    `);
  });

  test("leaves an old recovery that is no longer pending alone", async () => {
    const { outcome, trace } = await startRecoveryIfSettled(
      settledCollaborators({
        recoveries: {
          findByPaymentAttemptId: succeed({
            state: "processing",
            createdAt: minutesAgo(5),
          }),
        },
      })
    );

    expect(outcome).toBe("recovery_started");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentVerification.startRecoveryIfSettled",
        "call reservations.findById(reservation-id)",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
      ]
    `);
  });

  test("reports not verifiable when the stalled recovery can't be enqueued", async () => {
    const { outcome, trace } = await startRecoveryIfSettled(
      settledCollaborators({
        recoveries: {
          findByPaymentAttemptId: succeed({
            state: "pending",
            createdAt: minutesAgo(5),
          }),
        },
        recoveryQueue: { enqueue: fail(new Error("queue down")) },
      })
    );

    expect(outcome).toBe("not_verifiable");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentVerification.startRecoveryIfSettled",
        "call reservations.findById(reservation-id)",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveryQueue.enqueue(paymentAttemptId=attempt-id)",
        "Error Late-payment verification failed (cause=<Error>) {orderId} in latePaymentVerification.startRecoveryIfSettled",
      ]
    `);
  });

  test("reports not verifiable for a missing payment attempt", async () => {
    const { outcome, trace } = await startRecoveryIfSettled(
      settledCollaborators({ paymentAttempts: { findById: succeed(null) } })
    );

    expect(outcome).toBe("not_verifiable");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentVerification.startRecoveryIfSettled",
        "call reservations.findById(reservation-id)",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call paymentAttempts.findById(attempt-id)",
      ]
    `);
  });

  test("reports not verifiable for a non-Nexi payment attempt", async () => {
    const { outcome, trace } = await startRecoveryIfSettled(
      settledCollaborators({
        paymentAttempts: {
          findById: succeed({ ...expiredAttempt, providerOrderId: null }),
        },
      })
    );

    expect(outcome).toBe("not_verifiable");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentVerification.startRecoveryIfSettled",
        "call reservations.findById(reservation-id)",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call paymentAttempts.findById(attempt-id)",
      ]
    `);
  });

  test("reports not verifiable for an attempt without a security token", async () => {
    const { outcome, trace } = await startRecoveryIfSettled(
      settledCollaborators({
        paymentAttempts: {
          findById: succeed({ ...expiredAttempt, securityToken: null }),
        },
      })
    );

    expect(outcome).toBe("not_verifiable");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentVerification.startRecoveryIfSettled",
        "call reservations.findById(reservation-id)",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call paymentAttempts.findById(attempt-id)",
      ]
    `);
  });

  test("reports not verifiable for an attempt that isn't terminal", async () => {
    const { outcome, trace } = await startRecoveryIfSettled(
      settledCollaborators({
        paymentAttempts: {
          findById: succeed({ ...expiredAttempt, state: "pending" }),
        },
      })
    );

    expect(outcome).toBe("not_verifiable");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentVerification.startRecoveryIfSettled",
        "call reservations.findById(reservation-id)",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call paymentAttempts.findById(attempt-id)",
      ]
    `);
  });

  test("reports not verifiable for an attempt with an invalid currency", async () => {
    const { outcome, trace } = await startRecoveryIfSettled(
      settledCollaborators({
        paymentAttempts: {
          findById: succeed({
            ...expiredAttempt,
            amount: { ...expiredAttempt.amount, currency: "XXX" },
          }),
        },
      })
    );

    expect(outcome).toBe("not_verifiable");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentVerification.startRecoveryIfSettled",
        "call reservations.findById(reservation-id)",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call paymentAttempts.findById(attempt-id)",
        "Error Late-payment verification failed (cause=<SchemaError>) {orderId} in latePaymentVerification.startRecoveryIfSettled",
      ]
    `);
  });

  test("reports a failed provider lookup", async () => {
    const { outcome, trace } = await startRecoveryIfSettled(
      settledCollaborators({
        nexi: { verifyPaymentOutcome: fail(new Error("nexi down")) },
      }),
      { verificationDeadline: "5 seconds" }
    );

    expect(outcome).toBe("provider_verification_failed");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentVerification.startRecoveryIfSettled",
        "call reservations.findById(reservation-id)",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call paymentAttempts.findById(attempt-id)",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=29000, currency=EUR, securityToken=security-token, deadline=5 seconds)",
        "Warn Late-payment verification provider lookup failed (cause=<Error>) {orderId} in latePaymentVerification.startRecoveryIfSettled",
      ]
    `);
  });

  test("reports a provider verification mismatch", async () => {
    const { outcome, trace } = await startRecoveryIfSettled(
      settledCollaborators({
        nexi: {
          verifyPaymentOutcome: succeed(verification("success", ["amount"])),
        },
      })
    );

    expect(outcome).toBe("verification_mismatch");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentVerification.startRecoveryIfSettled",
        "call reservations.findById(reservation-id)",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call paymentAttempts.findById(attempt-id)",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=29000, currency=EUR, securityToken=security-token, deadline=undefined)",
        "Warn Late-payment verification provider facts mismatch (mismatches=<Array>) {orderId} in latePaymentVerification.startRecoveryIfSettled",
      ]
    `);
  });

  test("reports an unsettled provider payment", async () => {
    const { outcome, trace } = await startRecoveryIfSettled(
      settledCollaborators({
        nexi: { verifyPaymentOutcome: succeed(verification("failure")) },
      })
    );

    expect(outcome).toBe("not_settled");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentVerification.startRecoveryIfSettled",
        "call reservations.findById(reservation-id)",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call paymentAttempts.findById(attempt-id)",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=29000, currency=EUR, securityToken=security-token, deadline=undefined)",
      ]
    `);
  });

  test("starts and enqueues recovery for a settled provider payment", async () => {
    const { outcome, trace } = await startRecoveryIfSettled(
      settledCollaborators(),
      { verificationDeadline: "5 seconds" }
    );

    expect(outcome).toBe("recovery_started");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentVerification.startRecoveryIfSettled",
        "call reservations.findById(reservation-id)",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call paymentAttempts.findById(attempt-id)",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=29000, currency=EUR, securityToken=security-token, deadline=5 seconds)",
        "Warn Nexi payment settled after the local payment attempt became terminal {orderId} in latePaymentVerification.startRecoveryIfSettled",
        "call recoveries.start(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, providerOperationId=operation-id, providerStatus=EXECUTED, verifiedPaidAt=<Instant>)",
        "call recoveryQueue.enqueue(paymentAttemptId=attempt-id)",
      ]
    `);
  });

  test("reports not verifiable when recovery can't be started", async () => {
    const { outcome, trace } = await startRecoveryIfSettled(
      settledCollaborators({
        recoveries: {
          findByPaymentAttemptId: succeed(null),
          start: fail(new Error("db down")),
        },
      })
    );

    expect(outcome).toBe("not_verifiable");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentVerification.startRecoveryIfSettled",
        "call reservations.findById(reservation-id)",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call paymentAttempts.findById(attempt-id)",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=29000, currency=EUR, securityToken=security-token, deadline=undefined)",
        "Warn Nexi payment settled after the local payment attempt became terminal {orderId} in latePaymentVerification.startRecoveryIfSettled",
        "call recoveries.start(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, providerOperationId=operation-id, providerStatus=EXECUTED, verifiedPaidAt=<Instant>)",
        "Error Late-payment verification failed (cause=<Error>) {orderId} in latePaymentVerification.startRecoveryIfSettled",
      ]
    `);
  });
});
