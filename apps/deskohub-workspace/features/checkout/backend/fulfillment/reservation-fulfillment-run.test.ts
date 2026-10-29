import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import {
  DotyposReservationCancelledError,
  DotyposService,
} from "@deskohub/dotypos";
import { EmailDeliveryIdSchema } from "@deskohub/email";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import { env, getAccountingDocumentSnapshotSecret } from "@/env";
import { ReservationInvoiceService } from "@/features/accounting/backend/reservation-invoice.service";
import type { IWorkspaceReservationService } from "@/features/reservation/backend/workspace-reservation.service";
import type { IFulfillmentLedger } from "./fulfillment-ledger.repository";
import type { IWorkspaceReservationEmailService } from "./workspace-reservation-email.service";

const testEmailAddressForCustomer = testEmailAddress("customer");

mock.module("server-only", () => ({}));

// Bun module mocks are process-wide across files in a multi-file run, and the
// production acceptance test pins "@/env" to VERCEL_ENV "production". Pin it
// back here so this file always exercises the non-production fulfillment
// branch regardless of test-file ordering.
mock.module("@/env", () => ({
  env: new Proxy(env, {
    get: (target, key) =>
      key === "VERCEL_ENV" ? undefined : Reflect.get(target, key),
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
const { FulfillmentLedger } = await import("./fulfillment-ledger.repository");
const { WorkspaceReservationService } = await import(
  "@/features/reservation/backend/workspace-reservation.service"
);
const {
  CustomerEmailLocaleService,
  ReservationAuthorDirectory,
  ReservationAuthorReadError,
} = await import("@/features/account");
// Reservations here are authorless unless a test provides its own authors.
const noReservationAuthors = Layer.mock(ReservationAuthorDirectory, {
  describe: () => Effect.succeed(new Map()),
});
const { PostHogEventService } = await import(
  "@/shared/backend/analytics/posthog-event.service"
);

describe("ReservationFulfillment.run", () => {
  test("retries stale processing paid orders and completes non-production fulfillment after send acceptance", async () => {
    const order = {
      id: "reservation-id",
      activePaymentAttemptId: "payment-attempt-id",
      paymentState: "paid",
      fulfillmentState: "processing",
      updatedAt: Temporal.Now.instant().subtract({
        milliseconds: PAID_FULFILLMENT_PROCESSING_RETRY_AFTER_MS + 1000,
      }),
    };
    const claimed = {
      ...order,
      reservationState: "confirmed",
      fulfillmentState: "processing",
      dotyposReservationId: "dotypos-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
      activeCustomerEmailDeliveryLocale: null,
      locale: "en-US",
    };
    const emailReservation = {
      ...claimed,
      reservationDetails: {
        kind: "cowork",
        entryTier: "basic",
        coffee: false,
      },
      customer: { email: testEmailAddressForCustomer },
      reservedFrom: Temporal.Instant.from("2026-07-01T08:00:00.000Z"),
      reservedUntil: Temporal.Instant.from("2026-07-02T08:00:00.000Z"),
      tableName: "12",
    };
    const claimPaidFulfillment = mock(() => Effect.succeed(claimed as never));
    const confirmReservation = mock(() =>
      Effect.die("already confirmed reservations do not call Dotypos")
    );
    const markReservationConfirmed = mock(() =>
      Effect.die("already confirmed reservations do not update confirmation")
    );
    const deliverySteps: string[] = [];
    const customerEmailDeliveryId = EmailDeliveryIdSchema.make(
      "accepted-customer-email-delivery"
    );
    const sendPaidReservationEmails = mock(() =>
      Effect.sync(() => {
        deliverySteps.push("email");
        return customerEmailDeliveryId;
      })
    );
    const resolveCustomerAccessCode = mock(() =>
      Effect.sync(() => {
        deliverySteps.push("access");
        return "access-code";
      })
    );
    const markFulfilled = mock(() => Effect.void);
    const processInvoice = mock(() => Effect.void);

    await Effect.gen(function* () {
      const service = yield* ReservationFulfillment;
      yield* service.run("reservation-id");
    }).pipe(
      Effect.provide(
        ReservationFulfillment.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              noReservationAuthors,
              Layer.mock(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(order as never)),
                markReservationConfirmed,
              }),
              Layer.mock(FulfillmentLedger, {
                retainActiveCustomerEmailDeliveryLocale: mock(
                  (input: { readonly locale: "en-US" | "cs-CZ" }) =>
                    Effect.succeed(input.locale)
                ),
                claimPaidFulfillment,
                markFulfilled,
                markFulfillmentFailed: mock(() => Effect.void),
              }),
              Layer.mock(DotyposService, {
                confirmReservation,
              }),
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
                resolveCustomerAccessCode,
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

    expect(claimPaidFulfillment).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "reservation-id",
        staleProcessingBefore: expect.any(Temporal.Instant),
      })
    );
    expect(confirmReservation).not.toHaveBeenCalled();
    expect(markReservationConfirmed).not.toHaveBeenCalled();
    expect(sendPaidReservationEmails).toHaveBeenCalledWith({
      reservation: emailReservation,
      customerEmailLocale: "en-US",
      author: null,
      customerEmailIdempotencyKey:
        "workspace-paid-reservation-access-reservation-id",
    });
    expect(resolveCustomerAccessCode).toHaveBeenCalledWith({
      reservationId: emailReservation.id,
      dotyposReservationId: emailReservation.dotyposReservationId,
      reservedFrom: emailReservation.reservedFrom,
      reservedUntil: emailReservation.reservedUntil,
    });
    expect(deliverySteps).toEqual(["access", "email"]);
    expect(markFulfilled).toHaveBeenCalledWith(
      expect.objectContaining({ id: "reservation-id" })
    );
    expect(processInvoice).toHaveBeenCalledWith({
      paymentAttemptId: "payment-attempt-id",
    });
  });

  test("issues the door code of an early-setup meeting room from its setup start", async () => {
    const order = {
      id: "reservation-id",
      activePaymentAttemptId: "payment-attempt-id",
      paymentState: "paid",
      fulfillmentState: "processing",
      updatedAt: Temporal.Now.instant().subtract({
        milliseconds: PAID_FULFILLMENT_PROCESSING_RETRY_AFTER_MS + 1000,
      }),
    };
    const claimed = {
      ...order,
      reservationState: "confirmed",
      fulfillmentState: "processing",
      dotyposReservationId: "dotypos-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
      activeCustomerEmailDeliveryLocale: null,
      locale: "en-US",
    };
    const emailReservation = {
      ...claimed,
      reservationDetails: { kind: "meeting-room", earlySetup: true },
      customer: { email: testEmailAddressForCustomer },
      setupFrom: Temporal.Instant.from("2026-07-01T07:45:00.000Z"),
      reservedFrom: Temporal.Instant.from("2026-07-01T08:00:00.000Z"),
      reservedUntil: Temporal.Instant.from("2026-07-01T10:00:00.000Z"),
    };
    const claimPaidFulfillment = mock(() => Effect.succeed(claimed as never));
    const confirmReservation = mock(() =>
      Effect.die("already confirmed reservations do not call Dotypos")
    );
    const markReservationConfirmed = mock(() =>
      Effect.die("already confirmed reservations do not update confirmation")
    );
    const deliverySteps: string[] = [];
    const customerEmailDeliveryId = EmailDeliveryIdSchema.make(
      "accepted-customer-email-delivery"
    );
    const sendPaidReservationEmails = mock(() =>
      Effect.sync(() => {
        deliverySteps.push("email");
        return customerEmailDeliveryId;
      })
    );
    const resolveCustomerAccessCode = mock(() =>
      Effect.sync(() => {
        deliverySteps.push("access");
        return "access-code";
      })
    );
    const markFulfilled = mock(() => Effect.void);
    const processInvoice = mock(() => Effect.void);

    await Effect.gen(function* () {
      const service = yield* ReservationFulfillment;
      yield* service.run("reservation-id");
    }).pipe(
      Effect.provide(
        ReservationFulfillment.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              noReservationAuthors,
              Layer.mock(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(order as never)),
                markReservationConfirmed,
              }),
              Layer.mock(FulfillmentLedger, {
                retainActiveCustomerEmailDeliveryLocale: mock(
                  (input: { readonly locale: "en-US" | "cs-CZ" }) =>
                    Effect.succeed(input.locale)
                ),
                claimPaidFulfillment,
                markFulfilled,
                markFulfillmentFailed: mock(() => Effect.void),
              }),
              Layer.mock(DotyposService, {
                confirmReservation,
              }),
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
                resolveCustomerAccessCode,
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

    expect(resolveCustomerAccessCode).toHaveBeenCalledWith({
      reservationId: emailReservation.id,
      dotyposReservationId: emailReservation.dotyposReservationId,
      reservedFrom: emailReservation.setupFrom,
      reservedUntil: emailReservation.reservedUntil,
    });
  });

  test("hands the reservation's author to the first paid emails only and still fulfills when the author can't be read", async () => {
    const author = {
      kind: "active",
      accountId: "author-account-id",
      dotyposCustomerId: "author-dotypos-customer-id",
      email: testEmailAddress("author"),
      locale: "cs-CZ",
    } as const;
    const fulfill = async (
      describe: () => ReturnType<
        (typeof ReservationAuthorDirectory)["Service"]["describe"]
      >,
      priorCustomerEmailDeliveryId: string | null = null
    ) => {
      const order = {
        id: "reservation-id",
        activePaymentAttemptId: "payment-attempt-id",
        paymentState: "paid",
        fulfillmentState: priorCustomerEmailDeliveryId
          ? "failed"
          : "not_started",
        activeCustomerEmailDeliveryId: priorCustomerEmailDeliveryId,
      };
      const claimed = {
        ...order,
        authorAccountId: author.accountId,
        reservationState: "confirmed",
        fulfillmentState: "processing",
        dotyposReservationId: "dotypos-reservation-id",
        dotyposCustomerId: "dotypos-customer-id",
        activeCustomerEmailDeliveryLocale: null,
        locale: "en-US",
      };
      const emailReservation = {
        ...claimed,
        reservationDetails: {
          kind: "cowork",
          entryTier: "basic",
          coffee: false,
        },
        customer: { email: testEmailAddressForCustomer },
        reservedFrom: Temporal.Instant.from("2026-07-01T08:00:00.000Z"),
        reservedUntil: Temporal.Instant.from("2026-07-02T08:00:00.000Z"),
      };
      const sendPaidReservationEmails = mock(() =>
        Effect.succeed(
          EmailDeliveryIdSchema.make("accepted-customer-email-delivery")
        )
      );
      const markFulfilled = mock(() => Effect.void);
      const describeAuthors = mock(describe);

      await Effect.gen(function* () {
        const service = yield* ReservationFulfillment;
        yield* service.run("reservation-id");
      }).pipe(
        Effect.provide(
          ReservationFulfillment.Default.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.mock(ReservationAuthorDirectory, {
                  describe: describeAuthors,
                }),
                Layer.mock(WorkspaceReservationRepository, {
                  findById: mock(() => Effect.succeed(order as never)),
                }),
                Layer.mock(FulfillmentLedger, {
                  retainActiveCustomerEmailDeliveryLocale: mock(
                    (input: { readonly locale: "en-US" | "cs-CZ" }) =>
                      Effect.succeed(input.locale)
                  ),
                  claimPaidFulfillment: mock(() =>
                    Effect.succeed(claimed as never)
                  ),
                  markFulfilled,
                  markFulfillmentFailed: mock(() => Effect.void),
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
                  processByPaymentAttemptId: mock(() => Effect.void),
                })
              )
            )
          )
        ),
        Effect.runPromise
      );

      return { sendPaidReservationEmails, markFulfilled, describeAuthors };
    };

    const described = await fulfill(() =>
      Effect.succeed(new Map([[author.accountId, author]]) as never)
    );
    expect(described.sendPaidReservationEmails).toHaveBeenCalledWith(
      expect.objectContaining({ author })
    );
    expect(described.markFulfilled).toHaveBeenCalled();

    const unreadable = await fulfill(() =>
      Effect.fail(
        new ReservationAuthorReadError({ code: "reservation-author.read" })
      )
    );
    expect(unreadable.sendPaidReservationEmails).toHaveBeenCalledWith(
      expect.objectContaining({ author: null })
    );
    expect(unreadable.markFulfilled).toHaveBeenCalled();

    const recovery = await fulfill(
      () => Effect.succeed(new Map([[author.accountId, author]]) as never),
      "bounced-customer-email-delivery"
    );
    expect(recovery.describeAuthors).not.toHaveBeenCalled();
    expect(recovery.sendPaidReservationEmails).toHaveBeenCalledWith(
      expect.objectContaining({ author: null })
    );
  });

  test("confirms held paid orders, sends emails, and completes non-production fulfillment", async () => {
    const order = {
      id: "reservation-id",
      activePaymentAttemptId: "payment-attempt-id",
      paymentState: "paid",
      fulfillmentState: "not_started",
    };
    const claimed = {
      ...order,
      reservationState: "held",
      fulfillmentState: "processing",
      dotyposReservationId: "dotypos-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
      activeCustomerEmailDeliveryLocale: null,
      locale: "en-US",
    };
    const emailReservation = {
      ...claimed,
      reservationDetails: {
        kind: "cowork",
        entryTier: "basic",
        coffee: false,
      },
      customer: { email: testEmailAddressForCustomer },
      reservedFrom: Temporal.Instant.from("2026-07-01T08:00:00.000Z"),
      reservedUntil: Temporal.Instant.from("2026-07-02T08:00:00.000Z"),
      tableName: "12",
    };
    const confirmReservation = mock(() => Effect.void);
    const markReservationConfirmed = mock(() => Effect.void);
    const sendPaidReservationEmails = mock(() =>
      Effect.succeed(
        EmailDeliveryIdSchema.make("accepted-customer-email-delivery")
      )
    );
    const markFulfilled = mock(() => Effect.void);
    const processInvoice = mock(() => Effect.void);

    await Effect.gen(function* () {
      const service = yield* ReservationFulfillment;
      yield* service.run("reservation-id");
    }).pipe(
      Effect.provide(
        ReservationFulfillment.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              noReservationAuthors,
              Layer.mock(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(order as never)),
                markReservationConfirmed,
              }),
              Layer.mock(FulfillmentLedger, {
                retainActiveCustomerEmailDeliveryLocale: mock(
                  (input: { readonly locale: "en-US" | "cs-CZ" }) =>
                    Effect.succeed(input.locale)
                ),
                claimPaidFulfillment: mock(() =>
                  Effect.succeed(claimed as never)
                ),
                markFulfilled,
                markFulfillmentFailed: mock(() => Effect.void),
              }),
              Layer.mock(DotyposService, {
                confirmReservation,
              }),
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

    expect(confirmReservation).toHaveBeenCalledWith("dotypos-reservation-id");
    expect(markReservationConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({ id: "reservation-id" })
    );
    expect(sendPaidReservationEmails).toHaveBeenCalledWith({
      reservation: emailReservation,
      customerEmailLocale: "en-US",
      author: null,
      customerEmailIdempotencyKey:
        "workspace-paid-reservation-access-reservation-id",
    });
    expect(markFulfilled).toHaveBeenCalledWith(
      expect.objectContaining({ id: "reservation-id" })
    );
    expect(processInvoice).toHaveBeenCalledWith({
      paymentAttemptId: "payment-attempt-id",
    });
  });

  test("reuses one recovery idempotency key when a retry send itself fails", async () => {
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
      activeCustomerEmailDeliveryLocale: null,
      locale: "en-US",
    };
    const emailReservation = {
      ...claimed,
      reservationDetails: {
        kind: "cowork",
        entryTier: "basic",
        coffee: false,
      },
      customer: { email: testEmailAddressForCustomer },
      reservedFrom: Temporal.Instant.from("2026-07-01T08:00:00.000Z"),
      reservedUntil: Temporal.Instant.from("2026-07-02T08:00:00.000Z"),
      tableName: "12",
    };
    const sendFailure = new Error("synthetic email provider failure");
    const sendInputs: unknown[] = [];
    let sendAttempts = 0;
    const sendPaidReservationEmails = mock(
      (
        input: Parameters<
          IWorkspaceReservationEmailService["sendPaidReservationEmails"]
        >[0]
      ) => {
        sendInputs.push(input);
        sendAttempts += 1;
        return sendAttempts === 1
          ? Effect.fail(sendFailure)
          : Effect.succeed(EmailDeliveryIdSchema.make("recovered-delivery"));
      }
    );
    const markFulfillmentFailed = mock(() => Effect.void);
    const markFulfilled = mock(() => Effect.void);

    const runs = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const service = yield* ReservationFulfillment;
          const first = yield* service
            .run("reservation-id")
            .pipe(Effect.result);
          const second = yield* service
            .run("reservation-id")
            .pipe(Effect.result);
          return { first, second };
        }),
        ReservationFulfillment.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              noReservationAuthors,
              Layer.mock(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(order as never)),
              }),
              Layer.mock(FulfillmentLedger, {
                retainActiveCustomerEmailDeliveryLocale: mock(
                  (input: { readonly locale: "en-US" | "cs-CZ" }) =>
                    Effect.succeed(input.locale)
                ),
                claimPaidFulfillment: mock(() =>
                  Effect.succeed(claimed as never)
                ),
                markFulfilled,
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
                processByPaymentAttemptId: mock(() => Effect.void),
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
        failureCode: "fulfillment_email_failed",
      },
    });
    expect(markFulfillmentFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "reservation-id",
        failureCode: "fulfillment_email_failed",
      })
    );
    expect(sendInputs).toHaveLength(2);
    expect(sendInputs[0]).toEqual({
      reservation: emailReservation,
      customerEmailLocale: "en-US",
      author: null,
      customerEmailIdempotencyKey:
        createCustomerEmailRecoveryIdempotencyKey(priorDeliveryId),
    });
    expect(sendInputs[1]).toEqual(sendInputs[0]);
    expect(sendInputs[0]).not.toEqual({
      reservation: emailReservation,
      customerEmailLocale: "en-US",
      customerEmailIdempotencyKey:
        "workspace-paid-reservation-access-reservation-id",
    });
    expect(runs.second._tag).toBe("Success");
    // The recovered send supersedes the bounced one, so a stale webhook for
    // the prior delivery can no longer match the fulfilled reservation.
    expect(markFulfilled).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "reservation-id",
        customerEmailDeliveryId: "recovered-delivery",
      })
    );
  });

  test("skips awaiting_delivery paid orders even when updatedAt is stale", async () => {
    const order = {
      id: "reservation-id",
      activePaymentAttemptId: "payment-attempt-id",
      paymentState: "paid",
      fulfillmentState: "awaiting_delivery",
      updatedAt: Temporal.Now.instant().subtract({
        milliseconds: PAID_FULFILLMENT_PROCESSING_RETRY_AFTER_MS + 1000,
      }),
    };
    const claimPaidFulfillment = mock(() =>
      Effect.die("awaiting_delivery reservations must not be claimed")
    );
    const sendPaidReservationEmails = mock(() =>
      Effect.die("awaiting_delivery reservations must not send emails")
    );
    const markFulfillmentFailed = mock(() => Effect.void);

    const result = await Effect.gen(function* () {
      const service = yield* ReservationFulfillment;
      return yield* service.run("reservation-id").pipe(Effect.result);
    }).pipe(
      Effect.provide(
        ReservationFulfillment.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              noReservationAuthors,
              Layer.mock(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(order as never)),
              }),
              Layer.mock(FulfillmentLedger, {
                retainActiveCustomerEmailDeliveryLocale: mock(
                  (input: { readonly locale: "en-US" | "cs-CZ" }) =>
                    Effect.succeed(input.locale)
                ),
                claimPaidFulfillment,
                markFulfilled: mock(() => Effect.void),
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
                  Effect.die("email flow should not start")
                ),
              } satisfies IWorkspaceReservationService),
              Layer.mock(WorkspaceReservationEmailService, {
                sendPaidReservationEmails,
              } satisfies IWorkspaceReservationEmailService),
              Layer.mock(WorkspaceCheckoutAccessCodeService, {
                resolveCustomerAccessCode: mock(() =>
                  Effect.die("access flow should not start")
                ),
              }),
              Layer.mock(PostHogEventService, {
                capture: mock(() => Effect.void),
              }),
              Layer.mock(ReservationInvoiceService, {
                processByPaymentAttemptId: mock(() =>
                  Effect.die("invoice processing should not start")
                ),
              })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(result._tag).toBe("Success");
    expect(claimPaidFulfillment).not.toHaveBeenCalled();
    expect(sendPaidReservationEmails).not.toHaveBeenCalled();
    expect(markFulfillmentFailed).not.toHaveBeenCalled();
  });

  test("retries invoice processing without reverting completed access fulfillment", async () => {
    const invoiceFailure = new Error("synthetic invoice failure");
    const processInvoice = mock(() => Effect.fail(invoiceFailure));
    const markFulfillmentFailed = mock(() => Effect.void);
    const order = {
      id: "reservation-id",
      activePaymentAttemptId: "payment-attempt-id",
      paymentState: "paid",
      fulfillmentState: "fulfilled",
    };

    const result = await Effect.gen(function* () {
      const service = yield* ReservationFulfillment;
      return yield* service.run("reservation-id").pipe(Effect.result);
    }).pipe(
      Effect.provide(
        ReservationFulfillment.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              noReservationAuthors,
              Layer.mock(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(order as never)),
              }),
              Layer.mock(FulfillmentLedger, {
                retainActiveCustomerEmailDeliveryLocale: mock(
                  (input: { readonly locale: "en-US" | "cs-CZ" }) =>
                    Effect.succeed(input.locale)
                ),
                markFulfillmentFailed,
              }),
              Layer.mock(DotyposService, {}),
              Layer.mock(CustomerEmailLocaleService, {
                byDotyposCustomer: mock(() =>
                  Effect.succeed({ kind: "guest" })
                ),
              }),
              Layer.mock(WorkspaceReservationService, {}),
              Layer.mock(WorkspaceReservationEmailService, {}),
              Layer.mock(WorkspaceCheckoutAccessCodeService, {}),
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

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "WorkspacePaidFulfillmentError",
        failureCode: "invoice_processing_failed",
        cause: invoiceFailure,
      },
    });
    expect(markFulfillmentFailed).not.toHaveBeenCalled();
  });

  test("releases the fulfillment claim after an unexpected infrastructure failure", async () => {
    const order = {
      id: "reservation-id",
      paymentState: "paid",
      fulfillmentState: "not_started",
    };
    const claimed = {
      ...order,
      reservationState: "held",
      fulfillmentState: "processing",
      dotyposReservationId: "dotypos-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
      activeCustomerEmailDeliveryLocale: null,
      locale: "en-US",
    };
    const connectionFailure = new Error("database connection unavailable");
    const markFulfillmentFailed = mock(() => Effect.void);

    const result = await Effect.gen(function* () {
      const service = yield* ReservationFulfillment;
      return yield* service.run("reservation-id").pipe(Effect.result);
    }).pipe(
      Effect.provide(
        ReservationFulfillment.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              noReservationAuthors,
              Layer.mock(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(order as never)),
                markReservationConfirmed: mock(() =>
                  Effect.fail(connectionFailure)
                ),
              }),
              Layer.mock(FulfillmentLedger, {
                retainActiveCustomerEmailDeliveryLocale: mock(
                  (input: { readonly locale: "en-US" | "cs-CZ" }) =>
                    Effect.succeed(input.locale)
                ),
                claimPaidFulfillment: mock(() =>
                  Effect.succeed(claimed as never)
                ),
                markFulfilled: mock(() => Effect.void),
                markFulfillmentFailed,
              }),
              Layer.mock(DotyposService, {
                confirmReservation: mock(() => Effect.void),
              }),
              Layer.mock(CustomerEmailLocaleService, {
                byDotyposCustomer: mock(() =>
                  Effect.succeed({ kind: "guest" })
                ),
              }),
              Layer.mock(WorkspaceReservationService, {
                getReservation: mock(() =>
                  Effect.die("email flow should not start")
                ),
              } satisfies IWorkspaceReservationService),
              Layer.mock(WorkspaceReservationEmailService, {
                sendPaidReservationEmails: mock(() =>
                  Effect.die("email flow should not start")
                ),
              } satisfies IWorkspaceReservationEmailService),
              Layer.mock(WorkspaceCheckoutAccessCodeService, {
                resolveCustomerAccessCode: mock(() =>
                  Effect.die("access flow should not start")
                ),
              }),
              Layer.mock(PostHogEventService, {
                capture: mock(() => Effect.void),
              }),
              Layer.mock(ReservationInvoiceService, {
                processByPaymentAttemptId: mock(() =>
                  Effect.die("invoice processing should not start")
                ),
              })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure).toMatchObject({
        _tag: "WorkspacePaidFulfillmentError",
        failureCode: "fulfillment_completion_failed",
        cause: connectionFailure,
      });
    }
    expect(markFulfillmentFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "reservation-id",
        failureCode: "fulfillment_completion_failed",
      })
    );
  });

  test("sends the retained winner locale when a stale writer loses the retain race", async () => {
    const order = {
      id: "reservation-id",
      activePaymentAttemptId: "payment-attempt-id",
      paymentState: "paid",
      fulfillmentState: "failed",
    };
    const claimed = {
      ...order,
      reservationState: "confirmed",
      fulfillmentState: "processing",
      dotyposReservationId: "dotypos-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
      activeCustomerEmailDeliveryLocale: null,
      locale: "en-US",
    };
    const emailReservation = {
      ...claimed,
      reservationDetails: {
        kind: "cowork",
        entryTier: "basic",
        coffee: false,
      },
      customer: { email: testEmailAddressForCustomer },
      reservedFrom: Temporal.Instant.from("2026-07-01T08:00:00.000Z"),
      reservedUntil: Temporal.Instant.from("2026-07-02T08:00:00.000Z"),
      tableName: "12",
    };
    // The stale writer resolves the changed preference, but the repository
    // reports the locale the winning concurrent worker already retained for
    // this idempotency generation.
    const retainActiveCustomerEmailDeliveryLocale = mock(
      (
        input: Parameters<
          IFulfillmentLedger["retainActiveCustomerEmailDeliveryLocale"]
        >[0]
      ) => {
        expect(input.locale).toBe("cs-CZ");
        return Effect.succeed("en-US" as const);
      }
    );
    const sendInputs: unknown[] = [];
    const sendPaidReservationEmails = mock(
      (
        input: Parameters<
          IWorkspaceReservationEmailService["sendPaidReservationEmails"]
        >[0]
      ) => {
        sendInputs.push(input);
        return Effect.succeed(
          EmailDeliveryIdSchema.make("accepted-customer-email")
        );
      }
    );

    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const service = yield* ReservationFulfillment;
          yield* service.run("reservation-id");
        }),
        ReservationFulfillment.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              noReservationAuthors,
              Layer.mock(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(order as never)),
              }),
              Layer.mock(FulfillmentLedger, {
                claimPaidFulfillment: mock(() =>
                  Effect.succeed(claimed as never)
                ),
                retainActiveCustomerEmailDeliveryLocale,
                markFulfilled: mock(() => Effect.void),
                markFulfillmentFailed: mock(() => Effect.void),
              }),
              Layer.mock(DotyposService, {}),
              Layer.mock(CustomerEmailLocaleService, {
                byDotyposCustomer: mock(() =>
                  Effect.succeed({ kind: "account", locale: "cs-CZ" } as never)
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
                processByPaymentAttemptId: mock(() => Effect.void),
              })
            )
          )
        )
      )
    );

    // The stale writer must send the authoritative retained locale, so the
    // content under the generation's idempotency key stays consistent.
    expect(sendInputs).toHaveLength(1);
    expect(sendInputs[0]).toMatchObject({ customerEmailLocale: "en-US" });
  });

  test("fails without sending when the claimed locale generation closed before retention", async () => {
    const priorDeliveryId = EmailDeliveryIdSchema.make(
      "recorded-prior-customer-email-delivery"
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
      activeCustomerEmailDeliveryLocale: null,
      locale: "en-US",
    };
    const emailReservation = {
      ...claimed,
      reservationDetails: {
        kind: "cowork",
        entryTier: "basic",
        coffee: false,
      },
      customer: { email: testEmailAddressForCustomer },
      reservedFrom: Temporal.Instant.from("2026-07-01T08:00:00.000Z"),
      reservedUntil: Temporal.Instant.from("2026-07-02T08:00:00.000Z"),
      tableName: "12",
    };
    const retainInputs: Parameters<
      IFulfillmentLedger["retainActiveCustomerEmailDeliveryLocale"]
    >[0][] = [];
    // Another writer recorded this generation's accepted send between the
    // claim and the retention, so the repository reports the slot as closed.
    const retainActiveCustomerEmailDeliveryLocale = mock(
      (
        input: Parameters<
          IFulfillmentLedger["retainActiveCustomerEmailDeliveryLocale"]
        >[0]
      ) => {
        retainInputs.push(input);
        return Effect.succeed(null);
      }
    );
    const sendPaidReservationEmails = mock(() =>
      Effect.die("a closed generation must not send email")
    );
    const markFulfillmentFailed = mock(() => Effect.void);

    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const service = yield* ReservationFulfillment;
          return yield* service.run("reservation-id").pipe(Effect.result);
        }),
        ReservationFulfillment.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              noReservationAuthors,
              Layer.mock(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(order as never)),
              }),
              Layer.mock(FulfillmentLedger, {
                claimPaidFulfillment: mock(() =>
                  Effect.succeed(claimed as never)
                ),
                retainActiveCustomerEmailDeliveryLocale,
                markFulfilled: mock(() =>
                  Effect.die("a closed generation must not fulfill")
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
                  Effect.die("invoice processing should not start")
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
        failureCode: "fulfillment_email_failed",
      },
    });
    // Retention is bound to the claimed delivery generation, not just the
    // reservation row.
    expect(retainInputs).toEqual([
      {
        id: "reservation-id",
        locale: "en-US",
        expectedActiveCustomerEmailDeliveryId: priorDeliveryId,
      },
    ]);
    expect(sendPaidReservationEmails).not.toHaveBeenCalled();
    // The closed-generation failure carries no fulfillment marker: the row is
    // owned by whichever writer closed the generation, so this writer must not
    // mark it failed.
    expect(markFulfillmentFailed).not.toHaveBeenCalled();
  });

  test("records a Dotypos reservation read failure without an email failure code", async () => {
    const order = {
      id: "reservation-id",
      paymentState: "paid",
      fulfillmentState: "not_started",
    };
    const claimed = {
      ...order,
      reservationState: "confirmed",
      fulfillmentState: "processing",
      dotyposReservationId: "dotypos-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
    };
    const markFulfillmentFailed = mock(() => Effect.void);

    const result = await Effect.gen(function* () {
      const service = yield* ReservationFulfillment;
      return yield* service.run("reservation-id").pipe(Effect.result);
    }).pipe(
      Effect.provide(
        ReservationFulfillment.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              noReservationAuthors,
              Layer.mock(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(order as never)),
                markReservationConfirmed: mock(() =>
                  Effect.die("confirmed reservations are not reconfirmed")
                ),
              }),
              Layer.mock(FulfillmentLedger, {
                claimPaidFulfillment: mock(() =>
                  Effect.succeed(claimed as never)
                ),
                markFulfilled: mock(() =>
                  Effect.die("failed fulfillment must not complete")
                ),
                markFulfillmentFailed,
              }),
              Layer.mock(DotyposService, {
                confirmReservation: mock(() =>
                  Effect.die("confirmed reservations are not reconfirmed")
                ),
              }),
              Layer.mock(CustomerEmailLocaleService, {
                byDotyposCustomer: mock(() =>
                  Effect.succeed({ kind: "guest" })
                ),
              }),
              Layer.mock(WorkspaceReservationService, {
                getReservation: mock(() =>
                  Effect.fail(new Error("Dotypos read timed out") as never)
                ),
              } satisfies IWorkspaceReservationService),
              Layer.mock(WorkspaceReservationEmailService, {
                sendPaidReservationEmails: mock(() =>
                  Effect.die("email flow should not start")
                ),
              } satisfies IWorkspaceReservationEmailService),
              Layer.mock(WorkspaceCheckoutAccessCodeService, {
                resolveCustomerAccessCode: mock(() =>
                  Effect.die("access flow should not start")
                ),
              }),
              Layer.mock(PostHogEventService, {
                capture: mock(() => Effect.void),
              }),
              Layer.mock(ReservationInvoiceService, {
                processByPaymentAttemptId: mock(() =>
                  Effect.die("invoice processing should not start")
                ),
              })
            )
          )
        )
      ),
      Effect.runPromise
    );

    // Only a real email failure may later be repaired by a delivered
    // webhook, so a provider read failure must not reuse that code.
    expect(result._tag).toBe("Failure");
    expect(markFulfillmentFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "reservation-id",
        failureCode: "dotypos_reservation_failed",
      })
    );
  });

  test("does not confirm or deliver a paid order whose Dotypos hold was cancelled", async () => {
    const order = {
      id: "reservation-id",
      paymentState: "paid",
      fulfillmentState: "not_started",
    };
    const claimed = {
      ...order,
      reservationState: "held",
      fulfillmentState: "processing",
      dotyposReservationId: "dotypos-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
    };
    const cancelled = new DotyposReservationCancelledError({
      reservationId: "dotypos-reservation-id" as never,
      message: "Dotypos reservation is already cancelled.",
    });
    const markReservationConfirmed = mock(() => Effect.void);
    const markFulfillmentFailed = mock(() => Effect.void);

    const result = await Effect.gen(function* () {
      const service = yield* ReservationFulfillment;
      return yield* service.run("reservation-id").pipe(Effect.result);
    }).pipe(
      Effect.provide(
        ReservationFulfillment.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              noReservationAuthors,
              Layer.mock(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(order as never)),
                markReservationConfirmed,
              }),
              Layer.mock(FulfillmentLedger, {
                claimPaidFulfillment: mock(() =>
                  Effect.succeed(claimed as never)
                ),
                markFulfilled: mock(() =>
                  Effect.die("a cancelled hold must not be fulfilled")
                ),
                markFulfillmentFailed,
              }),
              Layer.mock(DotyposService, {
                confirmReservation: mock(() => Effect.fail(cancelled)),
              }),
              Layer.mock(CustomerEmailLocaleService, {
                byDotyposCustomer: mock(() =>
                  Effect.succeed({ kind: "guest" })
                ),
              }),
              Layer.mock(WorkspaceReservationService, {
                getReservation: mock(() =>
                  Effect.die("email flow should not start")
                ),
              } satisfies IWorkspaceReservationService),
              Layer.mock(WorkspaceReservationEmailService, {
                sendPaidReservationEmails: mock(() =>
                  Effect.die("email flow should not start")
                ),
              } satisfies IWorkspaceReservationEmailService),
              Layer.mock(WorkspaceCheckoutAccessCodeService, {
                resolveCustomerAccessCode: mock(() =>
                  Effect.die("access flow should not start")
                ),
              }),
              Layer.mock(PostHogEventService, {
                capture: mock(() => Effect.void),
              }),
              Layer.mock(ReservationInvoiceService, {
                processByPaymentAttemptId: mock(() =>
                  Effect.die("invoice processing should not start")
                ),
              })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure).toMatchObject({
        _tag: "WorkspacePaidFulfillmentError",
        failureCode: "dotypos_reservation_unfulfillable",
      });
    }
    expect(markReservationConfirmed).not.toHaveBeenCalled();
    expect(markFulfillmentFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "reservation-id",
        failureCode: "dotypos_reservation_unfulfillable",
      })
    );
  });
});
