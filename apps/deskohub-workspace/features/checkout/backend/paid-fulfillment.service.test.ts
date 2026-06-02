import "@/shared/testing/workspace-test-env";
import "@/shared/polyfills/temporal";
import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import type { Reservation } from "@deskohub/dotypos/generated";
import { Effect, Layer } from "effect";
import { buildWorkspaceCheckoutQuote } from "@/features/checkout/checkout-quote";
import { checkoutDetailsJsonSchema } from "@/features/checkout/schemas/checkout-details";
import { WorkspaceCheckoutEmailService } from "./checkout-email.service";
import { PaymentOrderRepository } from "./payment-order.repository";
import {
  WorkspacePaidFulfillmentService,
  WorkspacePaidFulfillmentServiceLive,
} from "./paid-fulfillment.service";
import { WorkspaceTableAssignmentService } from "./workspace-table-assignment.service";

type DotyposTestService = typeof DotyposService.Service;
type PaymentOrderTestRepository = typeof PaymentOrderRepository.Service;
type EmailTestService = typeof WorkspaceCheckoutEmailService.Service;

const reservation = {
  entryTier: "basic" as const,
  date: "2099-06-10",
  coffee: false,
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+420777123456",
};

const makeOrder = (overrides: Record<string, unknown> = {}) => {
  const quote = buildWorkspaceCheckoutQuote(reservation);

  return {
    id: "order-paid",
    provider: "nexi" as const,
    dotyposCustomerId: "customer",
    correlationId: "correlation",
    checkoutDetails: checkoutDetailsJsonSchema.parse({
      schema: "workspace-checkout-details",
      schemaVersion: 1,
      locale: "en-US",
      reservation: {
        tier: reservation.entryTier,
        date: reservation.date,
        coffee: reservation.coffee,
      },
      payment: {
        expectedPrice: quote.summary.total,
        quoteFingerprint: quote.fingerprint,
        summary: quote.summary,
      },
      legal: {},
      fulfillment: { accessCodePolicy: "workspace-static-v1" },
    }),
    reservationSubmitKey: "submit-key",
    dotyposReservationId: "reservation-new",
    dotyposReservationStatus: "NEW" as const,
    securityToken: "security-token",
    paymentStatus: "paid" as const,
    fulfillmentStatus: "not_started" as const,
    lastWebhookEventId: null,
    lastProviderOperationId: null,
    lastProviderStatus: null,
    failureCode: null,
    paidAt: new Date("2026-06-01T10:00:00.000Z"),
    reservationCreatedAt: new Date("2026-06-01T09:59:00.000Z"),
    reservationHoldExpiresAt: new Date("2026-06-01T10:10:00.000Z"),
    reservationHoldExpiredAt: null,
    reservationConfirmedAt: null,
    reservationCancelledAt: null,
    reservationCancellationFailureCode: null,
    reservationCancellationFailureMessage: null,
    customerAccessEmailSentAt: null,
    internalNotificationSentAt: null,
    fulfilledAt: null,
    fulfillmentFailedAt: null,
    fulfillmentFailureCode: null,
    createdAt: new Date("2026-06-01T09:58:00.000Z"),
    updatedAt: new Date("2026-06-01T10:00:00.000Z"),
    ...overrides,
  };
};

const makePaymentOrders = (initialOrder: ReturnType<typeof makeOrder>) => {
  let order = initialOrder;
  const updateOrder = (patch: Record<string, unknown>) => {
    order = { ...order, ...patch };
  };

  return {
    repository: {
      findById: mock(() => Effect.succeed(order)),
      claimPaidFulfillment: mock(() => {
        updateOrder({ fulfillmentStatus: "processing" as const });
        return Effect.succeed(order);
      }),
      markReservationConfirmed: mock((input) => {
        updateOrder({
          dotyposReservationStatus: "CONFIRMED" as const,
          reservationConfirmedAt: input.confirmedAt,
        });
        return Effect.void;
      }),
      attachDotyposReservation: mock((input) => {
        updateOrder({
          dotyposReservationId: input.dotyposReservationId,
          dotyposReservationStatus: "CONFIRMED" as const,
          reservationCreatedAt: input.reservationCreatedAt,
        });
        return Effect.void;
      }),
      markCustomerAccessEmailSent: mock((input) => {
        updateOrder({ customerAccessEmailSentAt: input.sentAt });
        return Effect.succeed(true);
      }),
      markInternalNotificationSent: mock((input) => {
        updateOrder({ internalNotificationSentAt: input.sentAt });
        return Effect.succeed(true);
      }),
      markFulfilled: mock((input) => {
        updateOrder({ fulfillmentStatus: "fulfilled" as const, fulfilledAt: input.fulfilledAt });
        return Effect.succeed(true);
      }),
      markFulfillmentFailed: mock((input) => {
        updateOrder({
          fulfillmentStatus: "failed" as const,
          fulfillmentFailureCode: input.failureCode,
          fulfillmentFailedAt: input.failedAt,
        });
        return Effect.void;
      }),
      create: mock(() => Effect.die("create not mocked")),
      findByReservationSubmitKey: mock(() => Effect.die("findByReservationSubmitKey not mocked")),
      mergeLegalEvidence: mock(() => Effect.die("mergeLegalEvidence not mocked")),
      updateCheckoutDetails: mock(() => Effect.die("updateCheckoutDetails not mocked")),
      deleteUnassociatedCreated: mock(() => Effect.die("deleteUnassociatedCreated not mocked")),
      attachNexiSession: mock(() => Effect.die("attachNexiSession not mocked")),
      claimNexiSessionCreation: mock(() => Effect.die("claimNexiSessionCreation not mocked")),
      markPaymentPending: mock(() => Effect.die("markPaymentPending not mocked")),
      resetUnsuccessfulForRetry: mock(() => Effect.die("resetUnsuccessfulForRetry not mocked")),
      markPaid: mock(() => Effect.die("markPaid not mocked")),
      markFailed: mock(() => Effect.die("markFailed not mocked")),
      markCancelled: mock(() => Effect.die("markCancelled not mocked")),
      markExpired: mock(() => Effect.die("markExpired not mocked")),
      markUnsuccessfulTerminal: mock(() => Effect.die("markUnsuccessfulTerminal not mocked")),
      claimReservationCreation: mock(() => Effect.die("claimReservationCreation not mocked")),
      releaseReservationCreation: mock(() => Effect.die("releaseReservationCreation not mocked")),
      attachNewReservationHold: mock(() => Effect.die("attachNewReservationHold not mocked")),
      markReservationAttachCancellationPending: mock(() => Effect.die("markReservationAttachCancellationPending not mocked")),
      claimReservationCancellation: mock(() => Effect.die("claimReservationCancellation not mocked")),
      markReservationCancelled: mock(() => Effect.die("markReservationCancelled not mocked")),
      markReservationCancellationFailed: mock(() => Effect.die("markReservationCancellationFailed not mocked")),
      selectExpiredReservationHolds: mock(() => Effect.die("selectExpiredReservationHolds not mocked")),
    } satisfies PaymentOrderTestRepository,
    getOrder: () => order,
  };
};

const makeDotypos = (overrides: Partial<DotyposTestService> = {}) => ({
  confirmReservation: mock(() => Effect.void),
  createReservation: mock(() => Effect.succeed({ id: "reservation-confirmed" } satisfies Reservation)),
  getCustomer: mock(() => Effect.succeed({ id: "customer", email: "ada@example.com", firstName: "Ada" })),
  cancelReservation: mock(() => Effect.die("cancelReservation not mocked")),
  getReservation: mock(() => Effect.die("getReservation not mocked")),
  getCustomerDiscount: mock(() => Effect.die("getCustomerDiscount not mocked")),
  findCustomer: mock(() => Effect.die("findCustomer not mocked")),
  findOrCreateCustomer: mock(() => Effect.die("findOrCreateCustomer not mocked")),
  getTables: mock(() => Effect.die("getTables not mocked")),
  listReservations: mock(() => Effect.die("listReservations not mocked")),
  getProducts: mock(() => Effect.die("getProducts not mocked")),
  getCategories: mock(() => Effect.die("getCategories not mocked")),
  ...overrides,
} satisfies DotyposTestService);

const makeEmails = (overrides: Partial<EmailTestService> = {}) => ({
  sendCustomerAccessEmail: mock(() => Effect.void),
  sendInternalPaidReservationEmail: mock(() => Effect.void),
  ...overrides,
} satisfies EmailTestService);

const runFulfillment = (
  input: {
    readonly paymentOrders: PaymentOrderTestRepository;
    readonly dotypos?: DotyposTestService;
    readonly emails?: EmailTestService;
  }
) =>
  Effect.gen(function* () {
    const service = yield* WorkspacePaidFulfillmentService;
    return yield* service.fulfillPaidOrder({ orderId: "order-paid" });
  }).pipe(
    Effect.provide(WorkspacePaidFulfillmentServiceLive),
    Effect.provide(Layer.succeed(PaymentOrderRepository, input.paymentOrders)),
    Effect.provide(Layer.succeed(DotyposService, input.dotypos ?? makeDotypos())),
    Effect.provide(Layer.succeed(WorkspaceCheckoutEmailService, input.emails ?? makeEmails())),
    Effect.provide(Layer.succeed(WorkspaceTableAssignmentService, {
      assignTableId: mock(() => Effect.succeed("table-basic")),
    })),
    Effect.runPromise
  );

describe("WorkspacePaidFulfillmentService", () => {
  test("confirms existing NEW hold before sending fulfillment emails", async () => {
    const state = makePaymentOrders(makeOrder());
    const confirmReservation = mock(() => Effect.void);

    await runFulfillment({
      paymentOrders: state.repository,
      dotypos: makeDotypos({ confirmReservation }),
    });

    expect(confirmReservation).toHaveBeenCalledWith("reservation-new");
    expect(state.repository.markReservationConfirmed).toHaveBeenCalledTimes(1);
    expect(state.getOrder().fulfillmentStatus).toBe("fulfilled");
  });

  test("legacy paid order without early hold creates CONFIRMED reservation", async () => {
    const state = makePaymentOrders(makeOrder({
      dotyposReservationId: null,
      dotyposReservationStatus: "none" as const,
    }));
    const createReservation = mock(() =>
      Effect.succeed({ id: "reservation-confirmed" } satisfies Reservation)
    );

    await runFulfillment({
      paymentOrders: state.repository,
      dotypos: makeDotypos({ createReservation }),
    });

    expect(createReservation.mock.calls[0]?.[0].status).toBe("CONFIRMED");
    expect(state.repository.attachDotyposReservation).toHaveBeenCalledWith({
      id: "order-paid",
      dotyposReservationId: "reservation-confirmed",
      reservationCreatedAt: expect.any(Date),
    });
    expect(state.getOrder().fulfillmentStatus).toBe("fulfilled");
  });

  test("paid cancelled hold is marked unfulfillable and does not send emails", async () => {
    const state = makePaymentOrders(makeOrder({
      dotyposReservationStatus: "CANCELLED" as const,
      reservationCancelledAt: new Date("2026-06-01T10:05:00.000Z"),
    }));
    const emails = makeEmails();

    await expect(
      runFulfillment({ paymentOrders: state.repository, emails })
    ).rejects.toThrow("Paid order reservation hold is no longer confirmable");

    expect(state.repository.markFulfillmentFailed).toHaveBeenCalledWith({
      id: "order-paid",
      failureCode: "dotypos_reservation_unfulfillable",
      failedAt: expect.any(Date),
    });
    expect(emails.sendCustomerAccessEmail).not.toHaveBeenCalled();
    expect(emails.sendInternalPaidReservationEmail).not.toHaveBeenCalled();
  });
});
