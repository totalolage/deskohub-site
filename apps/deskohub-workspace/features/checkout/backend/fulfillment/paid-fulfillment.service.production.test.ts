import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { EmailDeliveryIdSchema } from "@deskohub/email";
import { Effect, Layer } from "effect";
import { env, getAccountingDocumentSnapshotSecret } from "@/env";
import { ReservationInvoiceService } from "@/features/accounting/backend/reservation-invoice.service";
import type { IWorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import type { IWorkspaceReservationService } from "@/features/reservation/backend/workspace-reservation.service";
import type { IWorkspaceReservationEmailService } from "./workspace-reservation-email.service";

mock.module("server-only", () => ({}));

// The workspace env object bakes VERCEL_ENV at first import, so the accepted
// delivery branch is exercised through a retroactive override of "@/env" that
// only replaces VERCEL_ENV and delegates every other field to the real env.
mock.module("@/env", () => ({
  env: new Proxy(env, {
    get: (target, key) =>
      key === "VERCEL_ENV" ? "production" : Reflect.get(target, key),
  }),
  getAccountingDocumentSnapshotSecret,
}));

const { WorkspaceCheckoutAccessCodeService } = await import(
  "@/features/checkout/backend/reservation/access-code.service"
);
const { WorkspacePaidFulfillmentService } = await import(
  "./paid-fulfillment.service"
);
const {
  createCustomerEmailRecoveryIdempotencyKey,
  WorkspaceReservationEmailService,
} = await import("./workspace-reservation-email.service");
const { WorkspaceReservationRepository } = await import(
  "@/features/reservation/backend/workspace-reservation.repository"
);
const { WorkspaceReservationStateError } = await import(
  "@/features/reservation/backend/workspace-reservation.repository"
);
const { WorkspaceReservationDeliveryGenerationSupersededError } = await import(
  "@/features/reservation/backend/workspace-reservation.repository"
);
const { workspaceReservationIdSchema } = await import(
  "@/features/reservation/persistence-contracts"
);
const { WorkspaceReservationService } = await import(
  "@/features/reservation/backend/workspace-reservation.service"
);
const { CustomerEmailLocaleService } = await import("@/features/account");
const { PostHogEventService } = await import(
  "@/shared/backend/analytics/posthog-event.service"
);

describe("WorkspacePaidFulfillmentService production email acceptance", () => {
  test("records the accepted delivery id and leaves fulfillment awaiting the webhook", async () => {
    const order = {
      id: "reservation-id",
      activePaymentAttemptId: "payment-attempt-id",
      paymentState: "paid",
      fulfillmentState: "not_started",
    };
    const claimed = {
      ...order,
      reservationState: "confirmed",
      fulfillmentState: "processing",
      dotyposReservationId: "dotypos-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
      customerEmailDeliveryLocale: null,
      locale: "en-US",
    };
    const emailReservation = {
      ...claimed,
      reservationDetails: {
        kind: "cowork",
        entryTier: "basic",
        coffee: false,
      },
      customer: { email: "customer@example.com" },
      reservedFrom: Temporal.Instant.from("2026-07-01T08:00:00.000Z"),
      reservedUntil: Temporal.Instant.from("2026-07-02T08:00:00.000Z"),
      tableName: "12",
    };
    const customerEmailDeliveryId = EmailDeliveryIdSchema.make(
      "accepted-production-email-delivery"
    );
    const sendPaidReservationEmails = mock(() =>
      Effect.succeed(customerEmailDeliveryId)
    );
    const markAwaitingCustomerEmailDelivery = mock(() => Effect.void);
    const markFulfilled = mock(() =>
      Effect.die("production fulfillment must stay awaiting delivery")
    );
    const processInvoice = mock(() =>
      Effect.die("production acceptance must not process invoices")
    );

    const result = await Effect.gen(function* () {
      const service = yield* WorkspacePaidFulfillmentService;
      return yield* service
        .fulfillPaidOrder({ orderId: "reservation-id" })
        .pipe(Effect.result);
    }).pipe(
      Effect.provide(
        WorkspacePaidFulfillmentService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(order as never)),
                retainCustomerEmailDeliveryLocale: mock(
                  (input: { readonly locale: "en-US" | "cs-CZ" }) =>
                    Effect.succeed(input.locale)
                ),
                claimPaidFulfillment: mock(() =>
                  Effect.succeed(claimed as never)
                ),
                markAwaitingCustomerEmailDelivery,
                markFulfilled,
                markFulfillmentFailed: mock(() =>
                  Effect.die("production acceptance must not fail fulfillment")
                ),
              }),
              Layer.mock(DotyposService, {}),
              Layer.mock(CustomerEmailLocaleService, {
                byDotyposCustomer: mock(() =>
                  Effect.succeed({ kind: "guest" })
                ),
              }),
              Layer.mock(WorkspaceReservationService, {
                getReservation: mock(() =>
                  Effect.succeed(emailReservation as never)
                ),
              } satisfies IWorkspaceReservationService),
              Layer.mock(WorkspaceReservationEmailService, {
                sendPaidReservationEmails,
              } satisfies IWorkspaceReservationEmailService),
              Layer.mock(WorkspaceCheckoutAccessCodeService, {
                resolveCustomerAccessCode: mock(() =>
                  Effect.succeed("access-code")
                ),
              }),
              Layer.mock(PostHogEventService, {
                capture: mock(() => Effect.void),
              }),
              Layer.mock(ReservationInvoiceService, {
                processByPaymentAttemptId: processInvoice,
              })
            )
          )
        )
      ),
      Effect.runPromise
    );

    const { env: productionEnv } = await import("@/env");
    expect(productionEnv.VERCEL_ENV).toBe("production");
    expect(result._tag).toBe("Success");
    expect(sendPaidReservationEmails).toHaveBeenCalledWith({
      reservation: emailReservation,
      customerEmailLocale: "en-US",
      customerEmailIdempotencyKey:
        "workspace-paid-reservation-access-reservation-id",
    });
    expect(markAwaitingCustomerEmailDelivery).toHaveBeenCalledWith({
      id: "reservation-id",
      customerEmailDeliveryId,
      expectedActiveCustomerEmailDeliveryId: null,
    });
    expect(markFulfilled).not.toHaveBeenCalled();
    expect(processInvoice).not.toHaveBeenCalled();
  });

  test("retries a bounced delivery with a fresh idempotency key and attaches the new send", async () => {
    const priorDeliveryId = EmailDeliveryIdSchema.make(
      "bounced-customer-email-delivery"
    );
    const order = {
      id: "reservation-id",
      activePaymentAttemptId: "payment-attempt-id",
      paymentState: "paid",
      fulfillmentState: "failed",
      activeCustomerEmailDeliveryId: priorDeliveryId,
    };
    const claimed = {
      ...order,
      reservationState: "confirmed",
      fulfillmentState: "processing",
      dotyposReservationId: "dotypos-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
      customerEmailDeliveryLocale: null,
      locale: "en-US",
    };
    const emailReservation = {
      ...claimed,
      reservationDetails: {
        kind: "cowork",
        entryTier: "basic",
        coffee: false,
      },
      customer: { email: "customer@example.com" },
      reservedFrom: Temporal.Instant.from("2026-07-01T08:00:00.000Z"),
      reservedUntil: Temporal.Instant.from("2026-07-02T08:00:00.000Z"),
      tableName: "12",
    };
    const recoveredDeliveryId = EmailDeliveryIdSchema.make(
      "recovered-customer-email-delivery"
    );
    const sendPaidReservationEmails = mock(() =>
      Effect.succeed(recoveredDeliveryId)
    );
    const markAwaitingCustomerEmailDelivery = mock(() => Effect.void);
    const markFulfilled = mock(() =>
      Effect.die("production recovery must stay awaiting delivery")
    );

    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const service = yield* WorkspacePaidFulfillmentService;
          return yield* service
            .fulfillPaidOrder({ orderId: "reservation-id" })
            .pipe(Effect.result);
        }),
        WorkspacePaidFulfillmentService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(order as never)),
                retainCustomerEmailDeliveryLocale: mock(
                  (input: { readonly locale: "en-US" | "cs-CZ" }) =>
                    Effect.succeed(input.locale)
                ),
                claimPaidFulfillment: mock(() =>
                  Effect.succeed(claimed as never)
                ),
                markAwaitingCustomerEmailDelivery,
                markFulfilled,
                markFulfillmentFailed: mock(() =>
                  Effect.die("production recovery must not fail fulfillment")
                ),
              }),
              Layer.mock(DotyposService, {}),
              Layer.mock(CustomerEmailLocaleService, {
                byDotyposCustomer: mock(() =>
                  Effect.succeed({ kind: "guest" })
                ),
              }),
              Layer.mock(WorkspaceReservationService, {
                getReservation: mock(() =>
                  Effect.succeed(emailReservation as never)
                ),
              } satisfies IWorkspaceReservationService),
              Layer.mock(WorkspaceReservationEmailService, {
                sendPaidReservationEmails,
              } satisfies IWorkspaceReservationEmailService),
              Layer.mock(WorkspaceCheckoutAccessCodeService, {
                resolveCustomerAccessCode: mock(() =>
                  Effect.succeed("access-code")
                ),
              }),
              Layer.mock(PostHogEventService, {
                capture: mock(() => Effect.void),
              }),
              Layer.mock(ReservationInvoiceService, {
                processByPaymentAttemptId: mock(() =>
                  Effect.die("production acceptance must not process invoices")
                ),
              })
            )
          )
        )
      )
    );

    expect(result._tag).toBe("Success");
    expect(sendPaidReservationEmails).toHaveBeenCalledWith({
      reservation: emailReservation,
      customerEmailLocale: "en-US",
      customerEmailIdempotencyKey:
        createCustomerEmailRecoveryIdempotencyKey(priorDeliveryId),
    });
    expect(markAwaitingCustomerEmailDelivery).toHaveBeenCalledWith({
      id: "reservation-id",
      customerEmailDeliveryId: recoveredDeliveryId,
      expectedActiveCustomerEmailDeliveryId: priorDeliveryId,
    });
    expect(markFulfilled).not.toHaveBeenCalled();
  });

  test("retries the accepted initial send under the same key when delivery attachment fails before commit", async () => {
    const acceptedDeliveryId = EmailDeliveryIdSchema.make(
      "accepted-production-email-delivery"
    );
    const order = {
      id: "reservation-id",
      activePaymentAttemptId: "payment-attempt-id",
      paymentState: "paid",
      fulfillmentState: "not_started",
    };
    const claimed = {
      ...order,
      reservationState: "confirmed",
      fulfillmentState: "processing",
      dotyposReservationId: "dotypos-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
      customerEmailDeliveryLocale: null,
      locale: "en-US",
    };
    const emailReservation = {
      ...claimed,
      reservationDetails: {
        kind: "cowork",
        entryTier: "basic",
        coffee: false,
      },
      customer: { email: "customer@example.com" },
      reservedFrom: Temporal.Instant.from("2026-07-01T08:00:00.000Z"),
      reservedUntil: Temporal.Instant.from("2026-07-02T08:00:00.000Z"),
      tableName: "12",
    };
    const attachmentFailure = new Error(
      "synthetic delivery attachment failure before commit"
    );
    const sendInputs: unknown[] = [];
    const sendPaidReservationEmails = mock(
      (
        input: Parameters<
          IWorkspaceReservationEmailService["sendPaidReservationEmails"]
        >[0]
      ) => {
        sendInputs.push(input);
        return Effect.succeed(acceptedDeliveryId);
      }
    );
    let attachmentAttempts = 0;
    const markAwaitingCustomerEmailDelivery = mock(() => {
      attachmentAttempts += 1;
      return attachmentAttempts === 1
        ? Effect.fail(attachmentFailure)
        : Effect.void;
    });
    const markFulfillmentFailed = mock(() => Effect.void);

    const runs = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const service = yield* WorkspacePaidFulfillmentService;
          const first = yield* service
            .fulfillPaidOrder({ orderId: "reservation-id" })
            .pipe(Effect.result);
          const second = yield* service
            .fulfillPaidOrder({ orderId: "reservation-id" })
            .pipe(Effect.result);
          return { first, second };
        }),
        WorkspacePaidFulfillmentService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(order as never)),
                retainCustomerEmailDeliveryLocale: mock(
                  (input: { readonly locale: "en-US" | "cs-CZ" }) =>
                    Effect.succeed(input.locale)
                ),
                claimPaidFulfillment: mock(() =>
                  Effect.succeed(claimed as never)
                ),
                markAwaitingCustomerEmailDelivery,
                markFulfilled: mock(() =>
                  Effect.die(
                    "production fulfillment must stay awaiting delivery"
                  )
                ),
                markFulfillmentFailed,
              }),
              Layer.mock(DotyposService, {}),
              Layer.mock(CustomerEmailLocaleService, {
                byDotyposCustomer: mock(() =>
                  Effect.succeed({ kind: "guest" })
                ),
              }),
              Layer.mock(WorkspaceReservationService, {
                getReservation: mock(() =>
                  Effect.succeed(emailReservation as never)
                ),
              } satisfies IWorkspaceReservationService),
              Layer.mock(WorkspaceReservationEmailService, {
                sendPaidReservationEmails,
              } satisfies IWorkspaceReservationEmailService),
              Layer.mock(WorkspaceCheckoutAccessCodeService, {
                resolveCustomerAccessCode: mock(() =>
                  Effect.succeed("access-code")
                ),
              }),
              Layer.mock(PostHogEventService, {
                capture: mock(() => Effect.void),
              }),
              Layer.mock(ReservationInvoiceService, {
                processByPaymentAttemptId: mock(() =>
                  Effect.die("production acceptance must not process invoices")
                ),
              })
            )
          )
        )
      )
    );

    const initialSendInput = {
      reservation: emailReservation,
      customerEmailLocale: "en-US",
      customerEmailIdempotencyKey:
        "workspace-paid-reservation-access-reservation-id",
    };
    expect(runs.first).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "WorkspacePaidFulfillmentError",
        failureCode: "fulfillment_completion_failed",
        cause: attachmentFailure,
      },
    });
    expect(markFulfillmentFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "reservation-id",
        failureCode: "fulfillment_completion_failed",
      })
    );
    expect(sendInputs).toEqual([initialSendInput, initialSendInput]);
    expect(initialSendInput.customerEmailIdempotencyKey).not.toBe(
      createCustomerEmailRecoveryIdempotencyKey(acceptedDeliveryId)
    );
    expect(runs.second._tag).toBe("Success");
    expect(markAwaitingCustomerEmailDelivery).toHaveBeenCalledWith({
      id: "reservation-id",
      customerEmailDeliveryId: acceptedDeliveryId,
      expectedActiveCustomerEmailDeliveryId: null,
    });
  });

  test("keeps the retained locale for an accepted-but-unrecorded send when the preference changes", async () => {
    const order = {
      id: "reservation-id",
      activePaymentAttemptId: "payment-attempt-id",
      paymentState: "paid",
      fulfillmentState: "not_started",
    };
    const initialClaimed = {
      ...order,
      locale: "en-US",
      reservationState: "confirmed",
      fulfillmentState: "processing",
      dotyposReservationId: "dotypos-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
      customerEmailDeliveryLocale: null,
    };
    // The first accepted send recorded its delivery attachment failure, so the
    // generation stays open with its retained locale.
    const retainedClaimed = {
      ...initialClaimed,
      customerEmailDeliveryLocale: "cs-CZ" as const,
    };
    const emailReservation = {
      ...retainedClaimed,
      reservationDetails: {
        kind: "cowork",
        entryTier: "basic",
        coffee: false,
      },
      customer: { email: "customer@example.com" },
      reservedFrom: Temporal.Instant.from("2026-07-01T08:00:00.000Z"),
      reservedUntil: Temporal.Instant.from("2026-07-02T08:00:00.000Z"),
      tableName: "12",
    };
    const claims = [initialClaimed, retainedClaimed];
    const claimPaidFulfillment = mock(() =>
      Effect.succeed(claims.shift() as never)
    );
    // The customer changed the saved preference between the two attempts.
    const preferenceLocales = ["cs-CZ", "en-US"];
    const byDotyposCustomer = mock(() => {
      const locale = preferenceLocales.shift();
      return Effect.succeed({ kind: "account", locale } as never);
    });
    const retainInputs: Parameters<
      IWorkspaceReservationRepository["retainCustomerEmailDeliveryLocale"]
    >[0][] = [];
    const retainCustomerEmailDeliveryLocale = mock(
      (
        input: Parameters<
          IWorkspaceReservationRepository["retainCustomerEmailDeliveryLocale"]
        >[0]
      ) => {
        retainInputs.push(input);
        return Effect.succeed(input.locale);
      }
    );
    const attachmentFailure = new Error(
      "synthetic delivery attachment failure before commit"
    );
    let attachAttempts = 0;
    const markAwaitingCustomerEmailDelivery = mock(() => {
      attachAttempts += 1;
      return attachAttempts === 1
        ? Effect.fail(attachmentFailure)
        : Effect.void;
    });
    const sendInputs: unknown[] = [];
    const sendPaidReservationEmails = mock(
      (
        input: Parameters<
          IWorkspaceReservationEmailService["sendPaidReservationEmails"]
        >[0]
      ) => {
        sendInputs.push(input);
        return Effect.succeed(
          EmailDeliveryIdSchema.make(`accepted-${sendInputs.length}`)
        );
      }
    );

    const runs = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const service = yield* WorkspacePaidFulfillmentService;
          const first = yield* service
            .fulfillPaidOrder({ orderId: "reservation-id" })
            .pipe(Effect.result);
          const second = yield* service
            .fulfillPaidOrder({ orderId: "reservation-id" })
            .pipe(Effect.result);
          return { first, second };
        }),
        WorkspacePaidFulfillmentService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(order as never)),
                claimPaidFulfillment,
                retainCustomerEmailDeliveryLocale,
                markAwaitingCustomerEmailDelivery,
                markFulfilled: mock(() =>
                  Effect.die(
                    "production fulfillment must stay awaiting delivery"
                  )
                ),
                markFulfillmentFailed: mock(() => Effect.void),
              }),
              Layer.mock(DotyposService, {}),
              Layer.mock(CustomerEmailLocaleService, {
                byDotyposCustomer,
              }),
              Layer.mock(WorkspaceReservationService, {
                getReservation: mock(() =>
                  Effect.succeed(emailReservation as never)
                ),
              } satisfies IWorkspaceReservationService),
              Layer.mock(WorkspaceReservationEmailService, {
                sendPaidReservationEmails,
              } satisfies IWorkspaceReservationEmailService),
              Layer.mock(WorkspaceCheckoutAccessCodeService, {
                resolveCustomerAccessCode: mock(() =>
                  Effect.succeed("access-code")
                ),
              }),
              Layer.mock(PostHogEventService, {
                capture: mock(() => Effect.void),
              }),
              Layer.mock(ReservationInvoiceService, {
                processByPaymentAttemptId: mock(() =>
                  Effect.die("production acceptance must not process invoices")
                ),
              })
            )
          )
        )
      )
    );

    expect(runs.first).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "WorkspacePaidFulfillmentError",
        failureCode: "fulfillment_completion_failed",
        cause: attachmentFailure,
      },
    });
    expect(runs.second._tag).toBe("Success");
    expect(byDotyposCustomer).toHaveBeenCalledTimes(1);
    expect(retainInputs).toEqual([
      {
        id: "reservation-id",
        locale: "cs-CZ",
        expectedActiveCustomerEmailDeliveryId: null,
      },
    ]);
    expect(sendInputs).toHaveLength(2);
    expect(sendInputs[0]).toEqual({
      reservation: emailReservation,
      customerEmailLocale: "cs-CZ",
      customerEmailIdempotencyKey:
        "workspace-paid-reservation-access-reservation-id",
    });
    expect(sendInputs[1]).toEqual(sendInputs[0]);
  });

  test("treats a recording superseded by a newer delivery generation as a no-op without failing fulfillment", async () => {
    const order = {
      id: "reservation-id",
      activePaymentAttemptId: "payment-attempt-id",
      paymentState: "paid",
      fulfillmentState: "not_started",
    };
    const claimed = {
      ...order,
      reservationState: "confirmed",
      fulfillmentState: "processing",
      dotyposReservationId: "dotypos-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
      customerEmailDeliveryLocale: null,
      locale: "en-US",
    };
    const emailReservation = {
      ...claimed,
      reservationDetails: {
        kind: "cowork",
        entryTier: "basic",
        coffee: false,
      },
      customer: { email: "customer@example.com" },
      reservedFrom: Temporal.Instant.from("2026-07-01T08:00:00.000Z"),
      reservedUntil: Temporal.Instant.from("2026-07-02T08:00:00.000Z"),
      tableName: "12",
    };
    // A newer recovery generation already recorded its delivery, so this
    // old-generation recording is rejected by the repository's generation
    // guard instead of clobbering the newer generation.
    const supersededError =
      new WorkspaceReservationDeliveryGenerationSupersededError({
        operation: "workspaceReservations.markAwaitingCustomerEmailDelivery",
        reservationId: workspaceReservationIdSchema.make("reservation-id"),
        expectedActiveCustomerEmailDeliveryId: null,
        activeCustomerEmailDeliveryId: EmailDeliveryIdSchema.make(
          "newer-generation-delivery"
        ),
      });
    const markAwaitingCustomerEmailDelivery = mock(() =>
      Effect.fail(supersededError)
    );
    const markFulfillmentFailed = mock(() =>
      Effect.die("a superseded recording must not fail fulfillment")
    );

    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const service = yield* WorkspacePaidFulfillmentService;
          return yield* service
            .fulfillPaidOrder({ orderId: "reservation-id" })
            .pipe(Effect.result);
        }),
        WorkspacePaidFulfillmentService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(order as never)),
                retainCustomerEmailDeliveryLocale: mock(
                  (input: { readonly locale: "en-US" | "cs-CZ" }) =>
                    Effect.succeed(input.locale)
                ),
                claimPaidFulfillment: mock(() =>
                  Effect.succeed(claimed as never)
                ),
                markAwaitingCustomerEmailDelivery,
                markFulfilled: mock(() =>
                  Effect.die(
                    "production fulfillment must stay awaiting delivery"
                  )
                ),
                markFulfillmentFailed,
              }),
              Layer.mock(DotyposService, {}),
              Layer.mock(CustomerEmailLocaleService, {
                byDotyposCustomer: mock(() =>
                  Effect.succeed({ kind: "guest" })
                ),
              }),
              Layer.mock(WorkspaceReservationService, {
                getReservation: mock(() =>
                  Effect.succeed(emailReservation as never)
                ),
              } satisfies IWorkspaceReservationService),
              Layer.mock(WorkspaceReservationEmailService, {
                sendPaidReservationEmails: mock(() =>
                  Effect.succeed(EmailDeliveryIdSchema.make("stale-delivery"))
                ),
              } satisfies IWorkspaceReservationEmailService),
              Layer.mock(WorkspaceCheckoutAccessCodeService, {
                resolveCustomerAccessCode: mock(() =>
                  Effect.succeed("access-code")
                ),
              }),
              Layer.mock(PostHogEventService, {
                capture: mock(() => Effect.void),
              }),
              Layer.mock(ReservationInvoiceService, {
                processByPaymentAttemptId: mock(() =>
                  Effect.die("production acceptance must not process invoices")
                ),
              })
            )
          )
        )
      )
    );

    expect(result._tag).toBe("Success");
    expect(markFulfillmentFailed).not.toHaveBeenCalled();
  });

  test("fails fulfillment when the delivery recording rejects for a non-supersession reason", async () => {
    const order = {
      id: "reservation-id",
      activePaymentAttemptId: "payment-attempt-id",
      paymentState: "paid",
      fulfillmentState: "not_started",
    };
    const claimed = {
      ...order,
      reservationState: "confirmed",
      fulfillmentState: "processing",
      dotyposReservationId: "dotypos-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
      customerEmailDeliveryLocale: null,
      locale: "en-US",
    };
    const emailReservation = {
      ...claimed,
      reservationDetails: {
        kind: "cowork",
        entryTier: "basic",
        coffee: false,
      },
      customer: { email: "customer@example.com" },
      reservedFrom: Temporal.Instant.from("2026-07-01T08:00:00.000Z"),
      reservedUntil: Temporal.Instant.from("2026-07-02T08:00:00.000Z"),
      tableName: "12",
    };
    // The reservation is no longer claimable for recording even though the
    // delivery generation still matches, so this is a real invalid-state
    // failure, not a superseded generation.
    const stateError = new WorkspaceReservationStateError({
      operation: "workspaceReservations.markAwaitingCustomerEmailDelivery",
      reservationId: workspaceReservationIdSchema.make("reservation-id"),
      message:
        "Only processing paid reservations can await customer email delivery.",
    });
    const markAwaitingCustomerEmailDelivery = mock(() =>
      Effect.fail(stateError)
    );
    const markFulfillmentFailed = mock(() => Effect.void);

    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const service = yield* WorkspacePaidFulfillmentService;
          return yield* service
            .fulfillPaidOrder({ orderId: "reservation-id" })
            .pipe(Effect.result);
        }),
        WorkspacePaidFulfillmentService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(order as never)),
                retainCustomerEmailDeliveryLocale: mock(
                  (input: { readonly locale: "en-US" | "cs-CZ" }) =>
                    Effect.succeed(input.locale)
                ),
                claimPaidFulfillment: mock(() =>
                  Effect.succeed(claimed as never)
                ),
                markAwaitingCustomerEmailDelivery,
                markFulfilled: mock(() =>
                  Effect.die(
                    "production fulfillment must stay awaiting delivery"
                  )
                ),
                markFulfillmentFailed,
              }),
              Layer.mock(DotyposService, {}),
              Layer.mock(CustomerEmailLocaleService, {
                byDotyposCustomer: mock(() =>
                  Effect.succeed({ kind: "guest" })
                ),
              }),
              Layer.mock(WorkspaceReservationService, {
                getReservation: mock(() =>
                  Effect.succeed(emailReservation as never)
                ),
              } satisfies IWorkspaceReservationService),
              Layer.mock(WorkspaceReservationEmailService, {
                sendPaidReservationEmails: mock(() =>
                  Effect.succeed(
                    EmailDeliveryIdSchema.make("accepted-delivery")
                  )
                ),
              } satisfies IWorkspaceReservationEmailService),
              Layer.mock(WorkspaceCheckoutAccessCodeService, {
                resolveCustomerAccessCode: mock(() =>
                  Effect.succeed("access-code")
                ),
              }),
              Layer.mock(PostHogEventService, {
                capture: mock(() => Effect.void),
              }),
              Layer.mock(ReservationInvoiceService, {
                processByPaymentAttemptId: mock(() =>
                  Effect.die("production acceptance must not process invoices")
                ),
              })
            )
          )
        )
      )
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "WorkspacePaidFulfillmentError",
        failureCode: "fulfillment_completion_failed",
        cause: stateError,
      },
    });
    expect(markFulfillmentFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "reservation-id",
        failureCode: "fulfillment_completion_failed",
      })
    );
  });
});
