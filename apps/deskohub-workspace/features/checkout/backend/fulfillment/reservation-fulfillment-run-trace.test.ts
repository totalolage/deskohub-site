import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import {
  type DotyposConditionalWriteFailure,
  DotyposRejected,
  DotyposService,
  DotyposUnavailable,
  DotyposUncertain,
  DotyposVersionConflict,
} from "@deskohub/dotypos";
import { EmailDeliveryIdSchema } from "@deskohub/email";
import { Cause, type Context, Effect, Exit, Layer, Predicate } from "effect";
import { env, getAccountingDocumentSnapshotSecret } from "@/env";
import { ReservationInvoiceService } from "@/features/accounting/backend/reservation-invoice.service";
import {
  type EffectTrace,
  recordEffectTrace,
  startEffectTrace,
} from "@/shared/testing/effect-trace.test-utils";

mock.module("server-only", () => ({}));

// Bun module mocks are process-wide, so pin the deployment this file's runs
// see instead of relying on test-file ordering.
let vercelEnv: string | undefined;
const workspaceEnv = await import("@/env");
mock.module("@/env", () => ({
  ...workspaceEnv,
  env: new Proxy(env, {
    get: (target, key) =>
      key === "VERCEL_ENV" ? vercelEnv : Reflect.get(target, key),
  }),
  getAccountingDocumentSnapshotSecret,
}));

const { WorkspaceCheckoutAccessCodeService } = await import(
  "@/features/checkout/backend/reservation/access-code.service"
);
const { PAID_FULFILLMENT_PROCESSING_RETRY_AFTER_MS, ReservationFulfillment } =
  await import("./reservation-fulfillment.service");
const { createCustomerEmailRecoveryIdempotencyKey } = await import(
  "./customer-email-idempotency-key"
);
const { WorkspaceReservationEmailService } = await import(
  "./workspace-reservation-email.service"
);
const { WorkspaceReservationRepository } = await import(
  "@/features/reservation/backend/workspace-reservation.repository"
);
const {
  FulfillmentLedger,
  WorkspaceReservationDeliveryGenerationSupersededError,
} = await import("./fulfillment-ledger.repository");
const { WorkspaceReservationService } = await import(
  "@/features/reservation/backend/workspace-reservation.service"
);
const { CustomerEmailLocaleService, ReservationAuthorDirectory } = await import(
  "@/features/account"
);
const { CheckoutAnalytics } = await import(
  "../analytics/checkout-analytics.service"
);
const { silentCheckoutAnalytics } = await import(
  "../analytics/checkout-analytics.service.mock"
);

type Methods = Record<
  string,
  (...args: never[]) => Effect.Effect<unknown, unknown>
>;

interface Collaborators {
  readonly reservations?: Methods;
  readonly ledger?: Methods;
  readonly dotypos?: Methods;
  readonly reservationService?: Methods;
  readonly accessCodes?: Methods;
  readonly emails?: Methods;
  readonly authors?: Methods;
  readonly invoices?: Methods;
}

const orderId = "reservation-id";
const staleUpdatedAt = () =>
  Temporal.Now.instant().subtract({
    milliseconds: PAID_FULFILLMENT_PROCESSING_RETRY_AFTER_MS + 1000,
  });

const paidOrder = {
  id: orderId,
  activePaymentAttemptId: "payment-attempt-id",
  paymentState: "paid",
  fulfillmentState: "not_started",
  updatedAt: Temporal.Instant.from("2026-07-01T07:00:00.000Z"),
};

const claimedOrder = {
  ...paidOrder,
  fulfillmentState: "processing",
  reservationState: "confirmed",
  dotyposReservationId: "dotypos-reservation-id",
  dotyposCustomerId: "dotypos-customer-id",
  activeCustomerEmailDeliveryId: null,
  activeCustomerEmailDeliveryLocale: null,
  authorAccountId: "author-account-id",
};

const reservationForDelivery = {
  ...claimedOrder,
  reservedFrom: Temporal.Instant.from("2026-07-01T08:00:00.000Z"),
  reservedUntil: Temporal.Instant.from("2026-07-01T10:00:00.000Z"),
  setupFrom: undefined as Temporal.Instant | undefined,
};

const resendDeliveryId = EmailDeliveryIdSchema.make("resend-delivery-id");
const consoleDeliveryId = EmailDeliveryIdSchema.make("console-delivery-id");

const succeed =
  <A>(value: A) =>
  () =>
    Effect.succeed(value as never);
const fail =
  <E>(error: E) =>
  () =>
    Effect.fail(error as never);

/** Collaborators of a run that claims a confirmed order and sends its email. */
const deliveringCollaborators = (
  overrides: Collaborators = {}
): Collaborators => ({
  ...overrides,
  reservations: {
    findById: succeed(paidOrder),
    ...overrides.reservations,
  },
  ledger: {
    claimPaidFulfillment: succeed(claimedOrder),
    retainActiveCustomerEmailDeliveryLocale: succeed("cs-CZ"),
    markFulfilled: succeed(undefined),
    markFulfillmentFailed: succeed(undefined),
    ...overrides.ledger,
  },
  reservationService: {
    getReservation: succeed(reservationForDelivery),
    ...overrides.reservationService,
  },
  accessCodes: {
    resolveCustomerAccessCode: succeed("access-code"),
    ...overrides.accessCodes,
  },
  emails: {
    sendPaidReservationEmails: succeed(resendDeliveryId),
    ...overrides.emails,
  },
  authors: { describe: succeed(new Map()), ...overrides.authors },
  invoices: {
    processByPaymentAttemptId: succeed(undefined),
    ...overrides.invoices,
  },
});

type FulfillmentOperation = (
  fulfillment: Context.Service.Shape<typeof ReservationFulfillment>
) => Effect.Effect<unknown, unknown>;

const traceFulfillment = async (
  collaborators: Collaborators,
  operation: FulfillmentOperation,
  deployment: string | undefined = undefined
) => {
  vercelEnv = deployment;
  const trace: EffectTrace = startEffectTrace();
  const record = (service: string, methods: Methods | undefined) =>
    trace.recordCalls(service, methods ?? {});
  const exit = await Effect.gen(function* () {
    const fulfillment = yield* ReservationFulfillment;
    return yield* recordEffectTrace(trace, operation(fulfillment));
  }).pipe(
    Effect.provide(
      ReservationFulfillment.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(
              WorkspaceReservationRepository,
              record("reservations", collaborators.reservations)
            ),
            Layer.mock(
              FulfillmentLedger,
              record("ledger", collaborators.ledger)
            ),
            Layer.mock(
              DotyposService,
              record("dotypos", collaborators.dotypos)
            ),
            Layer.mock(
              WorkspaceReservationService,
              record("reservationService", collaborators.reservationService)
            ),
            Layer.mock(
              WorkspaceCheckoutAccessCodeService,
              record("accessCodes", collaborators.accessCodes)
            ),
            Layer.mock(
              WorkspaceReservationEmailService,
              record("emails", collaborators.emails)
            ),
            Layer.mock(
              ReservationAuthorDirectory,
              record("authors", collaborators.authors)
            ),
            Layer.mock(
              ReservationInvoiceService,
              record("invoices", collaborators.invoices)
            ),
            Layer.mock(CustomerEmailLocaleService, {
              byDotyposCustomer: trace.recordCalls("emailLocale", {
                byDotyposCustomer: succeed({ kind: "guest" }),
              }).byDotyposCustomer,
            }),
            Layer.mock(
              CheckoutAnalytics,
              trace.recordCalls("checkoutAnalytics", silentCheckoutAnalytics)
            )
          )
        )
      )
    ),
    Effect.runPromise
  );
  return { exit, trace: trace.entries };
};

const runFulfillment = (
  collaborators: Collaborators,
  deployment: string | undefined = undefined
) =>
  traceFulfillment(
    collaborators,
    (fulfillment) => fulfillment.run(orderId as never),
    deployment
  );

/** The first typed failure of a failed run, if any. */
const failureOf = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

const failureCodeOf = (exit: Exit.Exit<unknown, unknown>) => {
  const failure = failureOf(exit);
  return Predicate.hasProperty(failure, "failureCode")
    ? failure.failureCode
    : undefined;
};

describe("ReservationFulfillment.run trace", () => {
  test("fails to load the order without marking it failed", async () => {
    const { exit, trace } = await runFulfillment({
      reservations: { findById: fail(new Error("database down")) },
    });

    expect(failureCodeOf(exit)).toBe("fulfillment_order_load_failed");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "Debug Paid fulfillment reservation lookup started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservations.findById(reservation-id)",
      ]
    `);
  });

  const expectSkipped = async (order: object | null) => {
    const { exit, trace } = await runFulfillment({
      reservations: { findById: succeed(order) },
    });
    expect(exit._tag).toBe("Success");
    return trace;
  };

  test("skips a missing order before claiming it", async () => {
    expect(await expectSkipped(null)).toMatchInlineSnapshot(`
      [
        "span workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "Debug Paid fulfillment reservation lookup started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservations.findById(reservation-id)",
        "Debug Paid fulfillment reservation loaded {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Warn Paid fulfillment skipped: reservation missing (reason=reservation_missing) {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
      ]
    `);
  });

  test("skips an unpaid order before claiming it", async () => {
    expect(
      await expectSkipped({ ...paidOrder, paymentState: "pending" })
    ).toMatchInlineSnapshot(`
      [
        "span workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "Debug Paid fulfillment reservation lookup started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservations.findById(reservation-id)",
        "Debug Paid fulfillment reservation loaded {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Warn Paid fulfillment skipped: reservation not paid (reason=reservation_not_paid) {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
      ]
    `);
  });

  test("skips an order awaiting its delivery report before claiming it", async () => {
    expect(
      await expectSkipped({
        ...paidOrder,
        fulfillmentState: "awaiting_delivery",
        updatedAt: staleUpdatedAt(),
      })
    ).toMatchInlineSnapshot(`
      [
        "span workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "Debug Paid fulfillment reservation lookup started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservations.findById(reservation-id)",
        "Debug Paid fulfillment reservation loaded {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment skipped: awaiting customer email delivery (reason=awaiting_customer_email_delivery) {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
      ]
    `);
  });

  test("skips an order another run is processing before claiming it", async () => {
    expect(
      await expectSkipped({
        ...paidOrder,
        fulfillmentState: "processing",
        updatedAt: Temporal.Now.instant(),
      })
    ).toMatchInlineSnapshot(`
      [
        "span workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "Debug Paid fulfillment reservation lookup started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservations.findById(reservation-id)",
        "Debug Paid fulfillment reservation loaded {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment skipped: already processing (reason=already_processing) {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
      ]
    `);
  });

  const expectInvoiceRetried = async (
    activePaymentAttemptId: string | null
  ) => {
    const { exit, trace } = await runFulfillment({
      reservations: {
        findById: succeed({
          ...paidOrder,
          fulfillmentState: "fulfilled",
          activePaymentAttemptId,
        }),
      },
      invoices: { processByPaymentAttemptId: succeed(undefined) },
    });
    expect(exit._tag).toBe("Success");
    return trace;
  };

  test("only retries the invoice of a fulfilled order with its payment attempt", async () => {
    expect(
      await expectInvoiceRetried(paidOrder.activePaymentAttemptId)
    ).toMatchInlineSnapshot(`
      [
        "span workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "Debug Paid fulfillment reservation lookup started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservations.findById(reservation-id)",
        "Debug Paid fulfillment reservation loaded {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid access fulfillment already completed; retrying invoice processing (reason=already_fulfilled) {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "span workspacePaidFulfillment.processReservationInvoice",
        "call invoices.processByPaymentAttemptId(paymentAttemptId=payment-attempt-id)",
      ]
    `);
  });

  test("skips the invoice of a fulfilled order without a payment attempt", async () => {
    expect(await expectInvoiceRetried(null)).toMatchInlineSnapshot(`
      [
        "span workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "Debug Paid fulfillment reservation lookup started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservations.findById(reservation-id)",
        "Debug Paid fulfillment reservation loaded {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid access fulfillment already completed; retrying invoice processing (reason=already_fulfilled) {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "span workspacePaidFulfillment.processReservationInvoice",
        "Warn Reservation invoice processing skipped: payment attempt missing (orderId=reservation-id) {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.processReservationInvoice",
      ]
    `);
  });

  test("fails a fulfilled order's invoice retry without marking it failed", async () => {
    const { exit, trace } = await runFulfillment({
      reservations: {
        findById: succeed({ ...paidOrder, fulfillmentState: "fulfilled" }),
      },
      invoices: { processByPaymentAttemptId: fail(new Error("invoice down")) },
    });

    expect(failureCodeOf(exit)).toBe("invoice_processing_failed");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "Debug Paid fulfillment reservation lookup started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservations.findById(reservation-id)",
        "Debug Paid fulfillment reservation loaded {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid access fulfillment already completed; retrying invoice processing (reason=already_fulfilled) {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "span workspacePaidFulfillment.processReservationInvoice",
        "call invoices.processByPaymentAttemptId(paymentAttemptId=payment-attempt-id)",
        "Fatal Reservation invoice processing failed (orderId=reservation-id, cause=<Error>) {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.processReservationInvoice",
      ]
    `);
  });

  test("retries a stale processing order and stops when the claim returns nothing", async () => {
    const { exit, trace } = await runFulfillment({
      reservations: {
        findById: succeed({
          ...paidOrder,
          fulfillmentState: "processing",
          updatedAt: staleUpdatedAt(),
        }),
      },
      ledger: { claimPaidFulfillment: succeed(null) },
    });

    expect(exit._tag).toBe("Success");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "Debug Paid fulfillment reservation lookup started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservations.findById(reservation-id)",
        "Debug Paid fulfillment reservation loaded {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Warn Paid fulfillment retrying stale processing reservation (reason=stale_processing, staleProcessingBefore=<Instant>) {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call ledger.claimPaidFulfillment(id=reservation-id, staleProcessingBefore=<Instant>)",
        "Debug Paid fulfillment claim completed {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Warn Paid fulfillment skipped: claim returned no reservation (reason=claim_returned_no_reservation) {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
      ]
    `);
  });

  test("fails a claim error without marking the order failed", async () => {
    const { exit, trace } = await runFulfillment({
      reservations: { findById: succeed(paidOrder) },
      ledger: { claimPaidFulfillment: fail(new Error("claim failed")) },
    });

    expect(failureCodeOf(exit)).toBe("fulfillment_claim_failed");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "Debug Paid fulfillment reservation lookup started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservations.findById(reservation-id)",
        "Debug Paid fulfillment reservation loaded {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call ledger.claimPaidFulfillment(id=reservation-id, staleProcessingBefore=<Instant>)",
      ]
    `);
  });

  const expectUnfulfillable = async (
    claimed: Record<string, string | null | Temporal.Instant>,
    markFulfillmentFailed: Methods[string]
  ) => {
    const { exit, trace } = await runFulfillment({
      reservations: { findById: succeed(paidOrder) },
      ledger: { claimPaidFulfillment: succeed(claimed), markFulfillmentFailed },
    });
    expect(failureCodeOf(exit)).toBe("dotypos_reservation_unfulfillable");
    return trace;
  };

  test("fails a claimed order without a Dotypos hold as unfulfillable, even when the failure marker fails", async () => {
    expect(
      await expectUnfulfillable(
        { ...claimedOrder, dotyposReservationId: null },
        fail(new Error("marker failed"))
      )
    ).toMatchInlineSnapshot(`
      [
        "span workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "Debug Paid fulfillment reservation lookup started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservations.findById(reservation-id)",
        "Debug Paid fulfillment reservation loaded {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call ledger.claimPaidFulfillment(id=reservation-id, staleProcessingBefore=<Instant>)",
        "Debug Paid fulfillment claim completed {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment claim succeeded {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Warn Paid fulfillment failed: missing Dotypos reservation hold (reason=missing_dotypos_reservation_id) {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "span workspacePaidFulfillment.fail",
        "Info Paid fulfillment failure handling started {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "Info Paid fulfillment failure marker started {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "call ledger.markFulfillmentFailed(id=reservation-id, failureCode=dotypos_reservation_unfulfillable, failedAt=<Instant>)",
        "Error Paid fulfillment failure marker failed (orderId=reservation-id, failureCode=dotypos_reservation_unfulfillable, cause=<Error>) {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "Info Paid fulfillment failure marker completed {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "Fatal Paid fulfillment failure handling completed {activePaymentAttemptId,cause,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
      ]
    `);
  });

  test("fails a claimed order that is no longer confirmable as unfulfillable", async () => {
    expect(
      await expectUnfulfillable(
        { ...claimedOrder, reservationState: "hold_expired" },
        succeed(undefined)
      )
    ).toMatchInlineSnapshot(`
      [
        "span workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "Debug Paid fulfillment reservation lookup started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservations.findById(reservation-id)",
        "Debug Paid fulfillment reservation loaded {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call ledger.claimPaidFulfillment(id=reservation-id, staleProcessingBefore=<Instant>)",
        "Debug Paid fulfillment claim completed {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment claim succeeded {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Warn Paid fulfillment failed: reservation no longer confirmable (reason=reservation_no_longer_confirmable) {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "span workspacePaidFulfillment.fail",
        "Info Paid fulfillment failure handling started {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "Info Paid fulfillment failure marker started {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "call ledger.markFulfillmentFailed(id=reservation-id, failureCode=dotypos_reservation_unfulfillable, failedAt=<Instant>)",
        "Info Paid fulfillment failure marker completed {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "Fatal Paid fulfillment failure handling completed {activePaymentAttemptId,cause,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
      ]
    `);
  });

  const expectConfirmationFailed = async (
    failure: DotyposConditionalWriteFailure
  ) => {
    const { exit, trace } = await runFulfillment({
      reservations: { findById: succeed(paidOrder) },
      ledger: {
        claimPaidFulfillment: succeed({
          ...claimedOrder,
          reservationState: "held",
        }),
        markFulfillmentFailed: succeed(undefined),
      },
      dotypos: { confirmReservation: fail(failure) },
    });
    expect(failureCodeOf(exit)).toBe("dotypos_reservation_failed");
    return trace;
  };

  test("fails a held order whose Dotypos confirmation is unavailable", async () => {
    expect(
      await expectConfirmationFailed(
        new DotyposUnavailable({
          operation: "confirmReservation",
          reason: "timeout",
        })
      )
    ).toMatchInlineSnapshot(`
      [
        "span workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "Debug Paid fulfillment reservation lookup started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservations.findById(reservation-id)",
        "Debug Paid fulfillment reservation loaded {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call ledger.claimPaidFulfillment(id=reservation-id, staleProcessingBefore=<Instant>)",
        "Debug Paid fulfillment claim completed {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment claim succeeded {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Dotypos paid reservation confirmation started {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call dotypos.confirmReservation(dotypos-reservation-id)",
        "Error Dotypos paid reservation confirmation failed (claimed=<Object>, cause=<DotyposUnavailable>) {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "span workspacePaidFulfillment.fail",
        "Info Paid fulfillment failure handling started {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "Info Paid fulfillment failure marker started {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "call ledger.markFulfillmentFailed(id=reservation-id, failureCode=dotypos_reservation_failed, failedAt=<Instant>)",
        "Info Paid fulfillment failure marker completed {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "Fatal Paid fulfillment failure handling completed {activePaymentAttemptId,cause,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
      ]
    `);
  });

  test("fails a held order whose Dotypos confirmation is rejected", async () => {
    expect(
      await expectConfirmationFailed(
        new DotyposRejected({
          operation: "confirmReservation",
          reason: "invalid-request",
        })
      )
    ).toMatchInlineSnapshot(`
      [
        "span workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "Debug Paid fulfillment reservation lookup started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservations.findById(reservation-id)",
        "Debug Paid fulfillment reservation loaded {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call ledger.claimPaidFulfillment(id=reservation-id, staleProcessingBefore=<Instant>)",
        "Debug Paid fulfillment claim completed {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment claim succeeded {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Dotypos paid reservation confirmation started {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call dotypos.confirmReservation(dotypos-reservation-id)",
        "Error Dotypos paid reservation confirmation failed (claimed=<Object>, cause=<DotyposRejected>) {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "span workspacePaidFulfillment.fail",
        "Info Paid fulfillment failure handling started {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "Info Paid fulfillment failure marker started {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "call ledger.markFulfillmentFailed(id=reservation-id, failureCode=dotypos_reservation_failed, failedAt=<Instant>)",
        "Info Paid fulfillment failure marker completed {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "Fatal Paid fulfillment failure handling completed {activePaymentAttemptId,cause,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
      ]
    `);
  });

  test("fails a held order whose Dotypos confirmation is uncertain", async () => {
    expect(
      await expectConfirmationFailed(
        new DotyposUncertain({
          operation: "confirmReservation",
          reason: "transport",
        })
      )
    ).toMatchInlineSnapshot(`
      [
        "span workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "Debug Paid fulfillment reservation lookup started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservations.findById(reservation-id)",
        "Debug Paid fulfillment reservation loaded {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call ledger.claimPaidFulfillment(id=reservation-id, staleProcessingBefore=<Instant>)",
        "Debug Paid fulfillment claim completed {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment claim succeeded {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Dotypos paid reservation confirmation started {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call dotypos.confirmReservation(dotypos-reservation-id)",
        "Error Dotypos paid reservation confirmation failed (claimed=<Object>, cause=<DotyposUncertain>) {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "span workspacePaidFulfillment.fail",
        "Info Paid fulfillment failure handling started {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "Info Paid fulfillment failure marker started {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "call ledger.markFulfillmentFailed(id=reservation-id, failureCode=dotypos_reservation_failed, failedAt=<Instant>)",
        "Info Paid fulfillment failure marker completed {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "Fatal Paid fulfillment failure handling completed {activePaymentAttemptId,cause,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
      ]
    `);
  });

  test("fails a held order whose Dotypos confirmation lost a version conflict", async () => {
    expect(
      await expectConfirmationFailed(
        new DotyposVersionConflict({ operation: "confirmReservation" })
      )
    ).toMatchInlineSnapshot(`
      [
        "span workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "Debug Paid fulfillment reservation lookup started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservations.findById(reservation-id)",
        "Debug Paid fulfillment reservation loaded {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call ledger.claimPaidFulfillment(id=reservation-id, staleProcessingBefore=<Instant>)",
        "Debug Paid fulfillment claim completed {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment claim succeeded {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Dotypos paid reservation confirmation started {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call dotypos.confirmReservation(dotypos-reservation-id)",
        "Error Dotypos paid reservation confirmation failed (claimed=<Object>, cause=<DotyposVersionConflict>) {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "span workspacePaidFulfillment.fail",
        "Info Paid fulfillment failure handling started {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "Info Paid fulfillment failure marker started {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "call ledger.markFulfillmentFailed(id=reservation-id, failureCode=dotypos_reservation_failed, failedAt=<Instant>)",
        "Info Paid fulfillment failure marker completed {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "Fatal Paid fulfillment failure handling completed {activePaymentAttemptId,cause,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
      ]
    `);
  });

  test("fails a held order as incomplete when its confirmation can't be recorded", async () => {
    const { exit, trace } = await runFulfillment({
      reservations: {
        findById: succeed(paidOrder),
        markReservationConfirmed: fail(new Error("update failed")),
      },
      ledger: {
        claimPaidFulfillment: succeed({
          ...claimedOrder,
          reservationState: "held",
        }),
        markFulfillmentFailed: succeed(undefined),
      },
      dotypos: { confirmReservation: succeed(undefined) },
    });

    expect(failureCodeOf(exit)).toBe("fulfillment_completion_failed");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "Debug Paid fulfillment reservation lookup started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservations.findById(reservation-id)",
        "Debug Paid fulfillment reservation loaded {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call ledger.claimPaidFulfillment(id=reservation-id, staleProcessingBefore=<Instant>)",
        "Debug Paid fulfillment claim completed {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment claim succeeded {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Dotypos paid reservation confirmation started {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call dotypos.confirmReservation(dotypos-reservation-id)",
        "Info Dotypos paid reservation confirmation succeeded {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment reservation confirmed marker started {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservations.markReservationConfirmed(id=reservation-id, confirmedAt=<Instant>)",
        "Error Paid fulfillment reservation confirmed marker failed (claimed=<Object>, cause=<Error>) {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "span workspacePaidFulfillment.fail",
        "Info Paid fulfillment failure handling started {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "Info Paid fulfillment failure marker started {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "call ledger.markFulfillmentFailed(id=reservation-id, failureCode=fulfillment_completion_failed, failedAt=<Instant>)",
        "Info Paid fulfillment failure marker completed {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "Fatal Paid fulfillment failure handling completed {activePaymentAttemptId,cause,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
      ]
    `);
  });

  test("confirms a held order, then fails when Dotypos can't return it for delivery", async () => {
    const { exit, trace } = await runFulfillment(
      deliveringCollaborators({
        reservations: { markReservationConfirmed: succeed(undefined) },
        ledger: {
          claimPaidFulfillment: succeed({
            ...claimedOrder,
            reservationState: "held",
          }),
        },
        dotypos: { confirmReservation: succeed(undefined) },
        reservationService: { getReservation: fail(new Error("read failed")) },
      })
    );

    expect(failureCodeOf(exit)).toBe("dotypos_reservation_failed");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "Debug Paid fulfillment reservation lookup started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservations.findById(reservation-id)",
        "Debug Paid fulfillment reservation loaded {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call ledger.claimPaidFulfillment(id=reservation-id, staleProcessingBefore=<Instant>)",
        "Debug Paid fulfillment claim completed {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment claim succeeded {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Dotypos paid reservation confirmation started {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call dotypos.confirmReservation(dotypos-reservation-id)",
        "Info Dotypos paid reservation confirmation succeeded {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment reservation confirmed marker started {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservations.markReservationConfirmed(id=reservation-id, confirmedAt=<Instant>)",
        "Info Paid fulfillment reservation confirmed marker succeeded {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call checkoutAnalytics.reservationCompleted(reservation=<Object>, timestamp=<Instant>)",
        "Info Paid reservation email flow started {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservationService.getReservation(reservation-id)",
        "Error Workspace paid reservation email flow failed (workspaceReservationId=reservation-id, dotyposCustomerId=dotypos-customer-id, cause=<Error>) {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "span workspacePaidFulfillment.fail",
        "Info Paid fulfillment failure handling started {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "Info Paid fulfillment failure marker started {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "call ledger.markFulfillmentFailed(id=reservation-id, failureCode=dotypos_reservation_failed, failedAt=<Instant>)",
        "Info Paid fulfillment failure marker completed {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "Fatal Paid fulfillment failure handling completed {activePaymentAttemptId,cause,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
      ]
    `);
  });

  test("issues an early-setup room's code from its setup start and fails when issuance fails", async () => {
    const resolveCustomerAccessCode = mock(fail(new Error("igloo down")));
    const setupFrom = Temporal.Instant.from("2026-07-01T07:30:00.000Z");
    const { exit, trace } = await runFulfillment(
      deliveringCollaborators({
        reservationService: {
          getReservation: succeed({ ...reservationForDelivery, setupFrom }),
        },
        accessCodes: { resolveCustomerAccessCode },
      })
    );

    expect(failureCodeOf(exit)).toBe("fulfillment_access_failed");
    expect(resolveCustomerAccessCode).toHaveBeenCalledWith({
      reservationId: orderId,
      dotyposReservationId: reservationForDelivery.dotyposReservationId,
      reservedFrom: setupFrom,
      reservedUntil: reservationForDelivery.reservedUntil,
    } as never);
    expect(trace).toMatchInlineSnapshot(`
      [
        "span workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "Debug Paid fulfillment reservation lookup started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservations.findById(reservation-id)",
        "Debug Paid fulfillment reservation loaded {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call ledger.claimPaidFulfillment(id=reservation-id, staleProcessingBefore=<Instant>)",
        "Debug Paid fulfillment claim completed {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment claim succeeded {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid reservation email flow started {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservationService.getReservation(reservation-id)",
        "call accessCodes.resolveCustomerAccessCode(reservationId=reservation-id, dotyposReservationId=dotypos-reservation-id, reservedFrom=<Instant>, reservedUntil=<Instant>)",
        "span workspacePaidFulfillment.fail",
        "Info Paid fulfillment failure handling started {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "Info Paid fulfillment failure marker started {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "call ledger.markFulfillmentFailed(id=reservation-id, failureCode=fulfillment_access_failed, failedAt=<Instant>)",
        "Info Paid fulfillment failure marker completed {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "Fatal Paid fulfillment failure handling completed {activePaymentAttemptId,cause,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
      ]
    `);
  });

  test("fails without sending when the claimed delivery generation closed before retention", async () => {
    const { exit, trace } = await runFulfillment(
      deliveringCollaborators({
        ledger: { retainActiveCustomerEmailDeliveryLocale: succeed(null) },
      })
    );

    expect(failureCodeOf(exit)).toBe("fulfillment_email_failed");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "Debug Paid fulfillment reservation lookup started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservations.findById(reservation-id)",
        "Debug Paid fulfillment reservation loaded {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call ledger.claimPaidFulfillment(id=reservation-id, staleProcessingBefore=<Instant>)",
        "Debug Paid fulfillment claim completed {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment claim succeeded {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid reservation email flow started {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservationService.getReservation(reservation-id)",
        "call accessCodes.resolveCustomerAccessCode(reservationId=reservation-id, dotyposReservationId=dotypos-reservation-id, reservedFrom=<Instant>, reservedUntil=<Instant>)",
        "call emailLocale.byDotyposCustomer(dotypos-customer-id)",
        "call ledger.retainActiveCustomerEmailDeliveryLocale(id=reservation-id, locale=cs-CZ, expectedActiveCustomerEmailDeliveryId=null)",
      ]
    `);
  });

  test("re-sends a recovery delivery in its retained locale without the author and fails when the send fails", async () => {
    const sendPaidReservationEmails = mock(fail(new Error("send failed")));
    const { exit, trace } = await runFulfillment(
      deliveringCollaborators({
        ledger: {
          claimPaidFulfillment: succeed({
            ...claimedOrder,
            activeCustomerEmailDeliveryId: resendDeliveryId,
            activeCustomerEmailDeliveryLocale: "en-US",
          }),
        },
        emails: { sendPaidReservationEmails },
      })
    );

    expect(failureCodeOf(exit)).toBe("fulfillment_email_failed");
    expect(sendPaidReservationEmails).toHaveBeenCalledWith(
      expect.objectContaining({
        customerEmailLocale: "en-US",
        author: null,
        customerEmailIdempotencyKey:
          createCustomerEmailRecoveryIdempotencyKey(resendDeliveryId),
      }) as never
    );
    expect(trace).toMatchInlineSnapshot(`
      [
        "span workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "Debug Paid fulfillment reservation lookup started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservations.findById(reservation-id)",
        "Debug Paid fulfillment reservation loaded {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call ledger.claimPaidFulfillment(id=reservation-id, staleProcessingBefore=<Instant>)",
        "Debug Paid fulfillment claim completed {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment claim succeeded {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid reservation email flow started {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservationService.getReservation(reservation-id)",
        "call accessCodes.resolveCustomerAccessCode(reservationId=reservation-id, dotyposReservationId=dotypos-reservation-id, reservedFrom=<Instant>, reservedUntil=<Instant>)",
        "call emails.sendPaidReservationEmails(reservation=<Object>, customerEmailLocale=en-US, author=null, customerEmailIdempotencyKey=workspace-paid-reservation-access-recovery-cde0dff88b3036e45f0faa1990fda8caa6b1dcf7b54f900a0dcb6d28f7bad31b)",
        "span workspacePaidFulfillment.fail",
        "Info Paid fulfillment failure handling started {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "Info Paid fulfillment failure marker started {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "call ledger.markFulfillmentFailed(id=reservation-id, failureCode=fulfillment_email_failed, failedAt=<Instant>)",
        "Info Paid fulfillment failure marker completed {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "Fatal Paid fulfillment failure handling completed {activePaymentAttemptId,cause,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
      ]
    `);
  });

  test("completes a non-production fulfillment once the email is accepted", async () => {
    const { exit, trace } = await runFulfillment(deliveringCollaborators());

    expect(exit._tag).toBe("Success");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "Debug Paid fulfillment reservation lookup started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservations.findById(reservation-id)",
        "Debug Paid fulfillment reservation loaded {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call ledger.claimPaidFulfillment(id=reservation-id, staleProcessingBefore=<Instant>)",
        "Debug Paid fulfillment claim completed {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment claim succeeded {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid reservation email flow started {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservationService.getReservation(reservation-id)",
        "call accessCodes.resolveCustomerAccessCode(reservationId=reservation-id, dotyposReservationId=dotypos-reservation-id, reservedFrom=<Instant>, reservedUntil=<Instant>)",
        "call emailLocale.byDotyposCustomer(dotypos-customer-id)",
        "call ledger.retainActiveCustomerEmailDeliveryLocale(id=reservation-id, locale=cs-CZ, expectedActiveCustomerEmailDeliveryId=null)",
        "span workspacePaidFulfillment.describeReservationAuthor",
        "call authors.describe(<Array>)",
        "call emails.sendPaidReservationEmails(reservation=<Object>, customerEmailLocale=cs-CZ, author=null, customerEmailIdempotencyKey=workspace-paid-reservation-access-reservation-id)",
        "Info Paid reservation email flow succeeded {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call ledger.markFulfilled(id=reservation-id, fulfilledAt=<Instant>, customerEmailDeliveryId=resend-delivery-id)",
        "span workspacePaidFulfillment.processReservationInvoice",
        "call invoices.processByPaymentAttemptId(paymentAttemptId=payment-attempt-id)",
        "Info Paid fulfillment completed after email provider acceptance (acceptedByConsole=false) {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
      ]
    `);
  });

  test("completes a production fulfillment accepted by the console provider", async () => {
    const { exit, trace } = await runFulfillment(
      deliveringCollaborators({
        emails: { sendPaidReservationEmails: succeed(consoleDeliveryId) },
      }),
      "production"
    );

    expect(exit._tag).toBe("Success");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "Debug Paid fulfillment reservation lookup started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservations.findById(reservation-id)",
        "Debug Paid fulfillment reservation loaded {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call ledger.claimPaidFulfillment(id=reservation-id, staleProcessingBefore=<Instant>)",
        "Debug Paid fulfillment claim completed {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment claim succeeded {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid reservation email flow started {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservationService.getReservation(reservation-id)",
        "call accessCodes.resolveCustomerAccessCode(reservationId=reservation-id, dotyposReservationId=dotypos-reservation-id, reservedFrom=<Instant>, reservedUntil=<Instant>)",
        "call emailLocale.byDotyposCustomer(dotypos-customer-id)",
        "call ledger.retainActiveCustomerEmailDeliveryLocale(id=reservation-id, locale=cs-CZ, expectedActiveCustomerEmailDeliveryId=null)",
        "span workspacePaidFulfillment.describeReservationAuthor",
        "call authors.describe(<Array>)",
        "call emails.sendPaidReservationEmails(reservation=<Object>, customerEmailLocale=cs-CZ, author=null, customerEmailIdempotencyKey=workspace-paid-reservation-access-reservation-id)",
        "Info Paid reservation email flow succeeded {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call ledger.markFulfilled(id=reservation-id, fulfilledAt=<Instant>, customerEmailDeliveryId=console-delivery-id)",
        "span workspacePaidFulfillment.processReservationInvoice",
        "call invoices.processByPaymentAttemptId(paymentAttemptId=payment-attempt-id)",
        "Info Paid fulfillment completed after email provider acceptance (acceptedByConsole=true) {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
      ]
    `);
  });

  const awaitProductionDelivery = (
    markAwaitingCustomerEmailDelivery: Methods[string]
  ) =>
    runFulfillment(
      deliveringCollaborators({
        ledger: { markAwaitingCustomerEmailDelivery },
      }),
      "production"
    );

  test("awaits a production delivery report after recording the accepted delivery", async () => {
    const { exit, trace } = await awaitProductionDelivery(succeed(undefined));

    expect(exit._tag).toBe("Success");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "Debug Paid fulfillment reservation lookup started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservations.findById(reservation-id)",
        "Debug Paid fulfillment reservation loaded {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call ledger.claimPaidFulfillment(id=reservation-id, staleProcessingBefore=<Instant>)",
        "Debug Paid fulfillment claim completed {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment claim succeeded {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid reservation email flow started {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservationService.getReservation(reservation-id)",
        "call accessCodes.resolveCustomerAccessCode(reservationId=reservation-id, dotyposReservationId=dotypos-reservation-id, reservedFrom=<Instant>, reservedUntil=<Instant>)",
        "call emailLocale.byDotyposCustomer(dotypos-customer-id)",
        "call ledger.retainActiveCustomerEmailDeliveryLocale(id=reservation-id, locale=cs-CZ, expectedActiveCustomerEmailDeliveryId=null)",
        "span workspacePaidFulfillment.describeReservationAuthor",
        "call authors.describe(<Array>)",
        "call emails.sendPaidReservationEmails(reservation=<Object>, customerEmailLocale=cs-CZ, author=null, customerEmailIdempotencyKey=workspace-paid-reservation-access-reservation-id)",
        "Info Paid reservation email flow succeeded {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment recorded accepted customer email delivery {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call ledger.markAwaitingCustomerEmailDelivery(id=reservation-id, customerEmailDeliveryId=resend-delivery-id, expectedActiveCustomerEmailDeliveryId=null)",
        "Info Paid fulfillment is awaiting Resend delivery webhook {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
      ]
    `);
  });

  test("awaits a production delivery report when a newer delivery generation superseded the recording", async () => {
    const { exit, trace } = await awaitProductionDelivery(
      fail(
        new WorkspaceReservationDeliveryGenerationSupersededError({
          operation: "markAwaitingCustomerEmailDelivery",
          reservationId: orderId as never,
          expectedActiveCustomerEmailDeliveryId: null,
          activeCustomerEmailDeliveryId: resendDeliveryId,
        })
      )
    );

    expect(exit._tag).toBe("Success");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "Debug Paid fulfillment reservation lookup started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservations.findById(reservation-id)",
        "Debug Paid fulfillment reservation loaded {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call ledger.claimPaidFulfillment(id=reservation-id, staleProcessingBefore=<Instant>)",
        "Debug Paid fulfillment claim completed {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment claim succeeded {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid reservation email flow started {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservationService.getReservation(reservation-id)",
        "call accessCodes.resolveCustomerAccessCode(reservationId=reservation-id, dotyposReservationId=dotypos-reservation-id, reservedFrom=<Instant>, reservedUntil=<Instant>)",
        "call emailLocale.byDotyposCustomer(dotypos-customer-id)",
        "call ledger.retainActiveCustomerEmailDeliveryLocale(id=reservation-id, locale=cs-CZ, expectedActiveCustomerEmailDeliveryId=null)",
        "span workspacePaidFulfillment.describeReservationAuthor",
        "call authors.describe(<Array>)",
        "call emails.sendPaidReservationEmails(reservation=<Object>, customerEmailLocale=cs-CZ, author=null, customerEmailIdempotencyKey=workspace-paid-reservation-access-reservation-id)",
        "Info Paid reservation email flow succeeded {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment recorded accepted customer email delivery {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call ledger.markAwaitingCustomerEmailDelivery(id=reservation-id, customerEmailDeliveryId=resend-delivery-id, expectedActiveCustomerEmailDeliveryId=null)",
        "Warn Paid fulfillment delivery recording superseded by a newer delivery generation (orderId=reservation-id) {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment is awaiting Resend delivery webhook {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
      ]
    `);
  });

  test("fails a production fulfillment as incomplete when its accepted delivery can't be recorded", async () => {
    const { exit, trace } = await awaitProductionDelivery(
      fail(new Error("db"))
    );

    expect(failureCodeOf(exit)).toBe("fulfillment_completion_failed");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "Debug Paid fulfillment reservation lookup started {input,orderId} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservations.findById(reservation-id)",
        "Debug Paid fulfillment reservation loaded {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call ledger.claimPaidFulfillment(id=reservation-id, staleProcessingBefore=<Instant>)",
        "Debug Paid fulfillment claim completed {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment claim succeeded {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid reservation email flow started {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call reservationService.getReservation(reservation-id)",
        "call accessCodes.resolveCustomerAccessCode(reservationId=reservation-id, dotyposReservationId=dotypos-reservation-id, reservedFrom=<Instant>, reservedUntil=<Instant>)",
        "call emailLocale.byDotyposCustomer(dotypos-customer-id)",
        "call ledger.retainActiveCustomerEmailDeliveryLocale(id=reservation-id, locale=cs-CZ, expectedActiveCustomerEmailDeliveryId=null)",
        "span workspacePaidFulfillment.describeReservationAuthor",
        "call authors.describe(<Array>)",
        "call emails.sendPaidReservationEmails(reservation=<Object>, customerEmailLocale=cs-CZ, author=null, customerEmailIdempotencyKey=workspace-paid-reservation-access-reservation-id)",
        "Info Paid reservation email flow succeeded {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "Info Paid fulfillment recorded accepted customer email delivery {activePaymentAttemptId,claimed,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fulfillPaidOrder",
        "call ledger.markAwaitingCustomerEmailDelivery(id=reservation-id, customerEmailDeliveryId=resend-delivery-id, expectedActiveCustomerEmailDeliveryId=null)",
        "span workspacePaidFulfillment.fail",
        "Info Paid fulfillment failure handling started {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "Info Paid fulfillment failure marker started {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "call ledger.markFulfillmentFailed(id=reservation-id, failureCode=fulfillment_completion_failed, failedAt=<Instant>)",
        "Info Paid fulfillment failure marker completed {activePaymentAttemptId,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
        "Fatal Paid fulfillment failure handling completed {activePaymentAttemptId,cause,claimed,dotyposReservationId,failureCode,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in workspacePaidFulfillment.fail",
      ]
    `);
  });
});

const deliveryReport = {
  deliveryId: resendDeliveryId,
  outcome: "delivered" as "delivered" | "failed",
  occurredAt: Temporal.Instant.from("2026-07-01T07:05:00.000Z"),
  accessEmail: { reservationId: orderId } as
    | { readonly reservationId: string }
    | undefined,
};

const awaitingOrder = {
  ...claimedOrder,
  fulfillmentState: "awaiting_delivery",
  activeCustomerEmailDeliveryId: resendDeliveryId,
};

const recordDelivery = (
  ledger: Methods,
  report: Partial<typeof deliveryReport> = {},
  invoices: Methods = { processByPaymentAttemptId: succeed(undefined) }
) =>
  traceFulfillment({ ledger, invoices }, (fulfillment) =>
    fulfillment.recordDelivery({ ...deliveryReport, ...report } as never)
  );

const outcomeOf = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  const failure = failureOf(exit);
  return Predicate.hasProperty(failure, "reason") ? failure.reason : undefined;
};

describe("ReservationFulfillment.recordDelivery trace", () => {
  test("fails a report whose reservation can't be loaded", async () => {
    const { exit, trace } = await recordDelivery({
      findByActiveCustomerEmailDeliveryId: fail(new Error("db down")),
    });

    expect(outcomeOf(exit)).toBe("reservation_load_failed");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationFulfillment.recordDelivery",
        "call ledger.findByActiveCustomerEmailDeliveryId(resend-delivery-id)",
      ]
    `);
  });

  test("asks for a retry of an access email reported before its delivery was attached", async () => {
    const { exit, trace } = await recordDelivery({
      findByActiveCustomerEmailDeliveryId: succeed(null),
    });

    expect(outcomeOf(exit)).toBe("delivery_unattached");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationFulfillment.recordDelivery",
        "call ledger.findByActiveCustomerEmailDeliveryId(resend-delivery-id)",
        "Warn Resend webhook arrived before the customer delivery was attached (workspaceReservationId=reservation-id) {} in reservationFulfillment.recordDelivery",
      ]
    `);
  });

  test("ignores an unknown delivery of another email", async () => {
    const { exit, trace } = await recordDelivery(
      { findByActiveCustomerEmailDeliveryId: succeed(null) },
      { accessEmail: undefined }
    );

    expect(outcomeOf(exit)).toEqual({ ignored: "unknown_email_delivery" });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationFulfillment.recordDelivery",
        "call ledger.findByActiveCustomerEmailDeliveryId(resend-delivery-id)",
        "Warn Resend webhook referenced an unknown customer email delivery {} in reservationFulfillment.recordDelivery",
      ]
    `);
  });

  test("ignores a known delivery whose tags name another email", async () => {
    const { exit, trace } = await recordDelivery(
      { findByActiveCustomerEmailDeliveryId: succeed(awaitingOrder) },
      { accessEmail: undefined }
    );

    expect(outcomeOf(exit)).toEqual({ ignored: "unrelated_email" });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationFulfillment.recordDelivery",
        "call ledger.findByActiveCustomerEmailDeliveryId(resend-delivery-id)",
      ]
    `);
  });

  test("ignores a delivery tagged with another reservation", async () => {
    const { exit, trace } = await recordDelivery(
      { findByActiveCustomerEmailDeliveryId: succeed(awaitingOrder) },
      { accessEmail: { reservationId: "other-reservation-id" } }
    );

    expect(outcomeOf(exit)).toEqual({ ignored: "reservation_mismatch" });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationFulfillment.recordDelivery",
        "call ledger.findByActiveCustomerEmailDeliveryId(resend-delivery-id)",
        "Warn Resend webhook reservation tag did not match the active delivery (workspaceReservationId=other-reservation-id) {} in reservationFulfillment.recordDelivery",
      ]
    `);
  });

  test("retries the invoice of an already fulfilled reservation on a delivered report", async () => {
    const { exit, trace } = await recordDelivery({
      findByActiveCustomerEmailDeliveryId: succeed({
        ...awaitingOrder,
        fulfillmentState: "fulfilled",
      }),
    });

    expect(outcomeOf(exit)).toEqual({
      ignored: "reservation_already_fulfilled",
    });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationFulfillment.recordDelivery",
        "call ledger.findByActiveCustomerEmailDeliveryId(resend-delivery-id)",
        "span resendWebhook.processReservationInvoice",
        "call invoices.processByPaymentAttemptId(paymentAttemptId=payment-attempt-id)",
      ]
    `);
  });

  test("skips the invoice of an already fulfilled reservation without a payment attempt", async () => {
    const { exit, trace } = await recordDelivery({
      findByActiveCustomerEmailDeliveryId: succeed({
        ...awaitingOrder,
        fulfillmentState: "fulfilled",
        activePaymentAttemptId: null,
      }),
    });

    expect(outcomeOf(exit)).toEqual({
      ignored: "reservation_already_fulfilled",
    });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationFulfillment.recordDelivery",
        "call ledger.findByActiveCustomerEmailDeliveryId(resend-delivery-id)",
        "span resendWebhook.processReservationInvoice",
        "Warn Reservation invoice processing skipped: payment attempt missing (workspaceReservationId=reservation-id) {} in resendWebhook.processReservationInvoice",
      ]
    `);
  });

  test("asks for a retry when the invoice of an already fulfilled reservation fails", async () => {
    const { exit, trace } = await recordDelivery(
      {
        findByActiveCustomerEmailDeliveryId: succeed({
          ...awaitingOrder,
          fulfillmentState: "fulfilled",
        }),
      },
      {},
      { processByPaymentAttemptId: fail(new Error("invoice down")) }
    );

    expect(outcomeOf(exit)).toBe("invoice_processing_failed");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationFulfillment.recordDelivery",
        "call ledger.findByActiveCustomerEmailDeliveryId(resend-delivery-id)",
        "span resendWebhook.processReservationInvoice",
        "call invoices.processByPaymentAttemptId(paymentAttemptId=payment-attempt-id)",
      ]
    `);
  });

  test("ignores a delivered report for a reservation that failed for another reason", async () => {
    const { exit, trace } = await recordDelivery({
      findByActiveCustomerEmailDeliveryId: succeed({
        ...awaitingOrder,
        fulfillmentState: "failed",
        fulfillmentFailureCode: "fulfillment_access_failed",
      }),
    });

    expect(outcomeOf(exit)).toEqual({ ignored: "reservation_already_failed" });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationFulfillment.recordDelivery",
        "call ledger.findByActiveCustomerEmailDeliveryId(resend-delivery-id)",
        "Info Resend delivery success ignored: reservation already failed (workspaceReservationId=reservation-id, fulfillmentFailureCode=fulfillment_access_failed) {} in reservationFulfillment.recordDelivery",
      ]
    `);
  });

  test("repairs an email-failed reservation on a delivered report", async () => {
    const fulfilled = { ...awaitingOrder, fulfillmentState: "fulfilled" };
    const { exit, trace } = await recordDelivery({
      findByActiveCustomerEmailDeliveryId: succeed({
        ...awaitingOrder,
        fulfillmentState: "failed",
        fulfillmentFailureCode: "fulfillment_email_failed",
      }),
      markCustomerEmailDeliveryFulfilled: succeed(fulfilled),
    });

    expect(outcomeOf(exit)).toBe("applied");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationFulfillment.recordDelivery",
        "call ledger.findByActiveCustomerEmailDeliveryId(resend-delivery-id)",
        "call ledger.markCustomerEmailDeliveryFulfilled(customerEmailDeliveryId=resend-delivery-id, fulfilledAt=<Instant>)",
        "call checkoutAnalytics.reservationFulfilled(reservation=<Object>, timestamp=<Instant>)",
        "span resendWebhook.processReservationInvoice",
        "call invoices.processByPaymentAttemptId(paymentAttemptId=payment-attempt-id)",
      ]
    `);
  });

  test("ignores a delivered report the ledger fence rejects", async () => {
    const { exit, trace } = await recordDelivery({
      findByActiveCustomerEmailDeliveryId: succeed(awaitingOrder),
      markCustomerEmailDeliveryFulfilled: succeed(null),
    });

    expect(outcomeOf(exit)).toEqual({
      ignored: "reservation_delivery_state_changed",
    });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationFulfillment.recordDelivery",
        "call ledger.findByActiveCustomerEmailDeliveryId(resend-delivery-id)",
        "call ledger.markCustomerEmailDeliveryFulfilled(customerEmailDeliveryId=resend-delivery-id, fulfilledAt=<Instant>)",
        "Info Resend delivery success ignored: reservation delivery state is newer or changed concurrently (workspaceReservationId=reservation-id, fulfillmentState=awaiting_delivery) {} in reservationFulfillment.recordDelivery",
      ]
    `);
  });

  test("asks for a retry when a delivered report can't be recorded", async () => {
    const { exit, trace } = await recordDelivery({
      findByActiveCustomerEmailDeliveryId: succeed(awaitingOrder),
      markCustomerEmailDeliveryFulfilled: fail(new Error("db down")),
    });

    expect(outcomeOf(exit)).toBe("reservation_update_failed");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationFulfillment.recordDelivery",
        "call ledger.findByActiveCustomerEmailDeliveryId(resend-delivery-id)",
        "call ledger.markCustomerEmailDeliveryFulfilled(customerEmailDeliveryId=resend-delivery-id, fulfilledAt=<Instant>)",
      ]
    `);
  });

  test("fails the fulfillment on a bounce", async () => {
    const { exit, trace } = await recordDelivery(
      {
        findByActiveCustomerEmailDeliveryId: succeed(awaitingOrder),
        markCustomerEmailDeliveryFailed: succeed({
          ...awaitingOrder,
          fulfillmentState: "failed",
        }),
      },
      { outcome: "failed" }
    );

    expect(outcomeOf(exit)).toBe("applied");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationFulfillment.recordDelivery",
        "call ledger.findByActiveCustomerEmailDeliveryId(resend-delivery-id)",
        "call ledger.markCustomerEmailDeliveryFailed(customerEmailDeliveryId=resend-delivery-id, failureCode=fulfillment_email_failed, failedAt=<Instant>)",
      ]
    `);
  });

  test("ignores a bounce the ledger fence rejects", async () => {
    const { exit, trace } = await recordDelivery(
      {
        findByActiveCustomerEmailDeliveryId: succeed(awaitingOrder),
        markCustomerEmailDeliveryFailed: succeed(null),
      },
      { outcome: "failed" }
    );

    expect(outcomeOf(exit)).toEqual({
      ignored: "reservation_delivery_state_changed",
    });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationFulfillment.recordDelivery",
        "call ledger.findByActiveCustomerEmailDeliveryId(resend-delivery-id)",
        "call ledger.markCustomerEmailDeliveryFailed(customerEmailDeliveryId=resend-delivery-id, failureCode=fulfillment_email_failed, failedAt=<Instant>)",
        "Info Resend delivery failure ignored: reservation delivery state is newer or changed concurrently (workspaceReservationId=reservation-id, fulfillmentState=awaiting_delivery) {} in reservationFulfillment.recordDelivery",
      ]
    `);
  });

  test("asks for a retry when a bounce can't be recorded", async () => {
    const { exit, trace } = await recordDelivery(
      {
        findByActiveCustomerEmailDeliveryId: succeed(awaitingOrder),
        markCustomerEmailDeliveryFailed: fail(new Error("db down")),
      },
      { outcome: "failed" }
    );

    expect(outcomeOf(exit)).toBe("reservation_update_failed");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationFulfillment.recordDelivery",
        "call ledger.findByActiveCustomerEmailDeliveryId(resend-delivery-id)",
        "call ledger.markCustomerEmailDeliveryFailed(customerEmailDeliveryId=resend-delivery-id, failureCode=fulfillment_email_failed, failedAt=<Instant>)",
      ]
    `);
  });
});
