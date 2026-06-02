import "@/shared/polyfills/temporal";
import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import type { PaymentOrder } from "@/db/schema";
import { getLegalAcceptanceSnapshot } from "@/features/legal/acceptance-snapshot";
import { getReservationOrderSchema } from "@/features/reservation/schemas/reservation";
import {
  getSubmitReservationCheckoutLocale,
  getSubmitReservationSchema,
} from "./submit-reservation-input";

mock.module("server-only", () => ({}));

const validSubmit = {
  locale: "en-US",
  payStateToken: "dhp1.test-token",
  legalConsent: true,
};

const validReservation = {
  entryTier: "basic",
  date: "2099-06-10",
  coffee: false,
  name: "Locale Test",
  email: "locale-test@example.com",
  phone: "+420777123463",
  message: "Locale propagation test",
  legalConsent: true,
};

const key = Buffer.alloc(32, 8).toString("base64url");

const setRequiredEnv = () => {
  process.env.CHECKOUT_PAY_STATE_KEYS = `test:${key}`;
  process.env.CLOUDINARY_API_KEY = "test";
  process.env.CLOUDINARY_API_SECRET = "test";
  process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/test";
  process.env.DOTYPOS_API_URL = "https://dotypos.example";
  process.env.DOTYPOS_BRANCH_ID = "branch";
  process.env.DOTYPOS_CLIENT_ID = "client";
  process.env.DOTYPOS_CLIENT_SECRET = "secret";
  process.env.DOTYPOS_CLOUD_ID = "cloud";
  process.env.DOTYPOS_EMPLOYEE_ID = "employee";
  process.env.DOTYPOS_REFRESH_TOKEN = "refresh";
  process.env.NEXI_API_KEY = "nexi";
  process.env.NEXI_API_ORIGIN = "https://xpaysandbox.nexigroup.com";
  process.env.VERCEL_ENV = "development";
  process.env.VERCEL_URL = "deskohub.test";
  process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = "cloud";
};

describe("submit reservation locale input", () => {
  test("uses explicit route locale instead of action context locale", () => {
    const schema = getSubmitReservationSchema();
    const input = schema.parse(validSubmit);

    expect(getSubmitReservationCheckoutLocale(input, "cs-CZ")).toBe("en-US");
  });

  test("accepts Czech route locale for checkout creation", () => {
    const schema = getSubmitReservationSchema();
    const input = schema.parse({
      ...validSubmit,
      locale: "cs-CZ",
    });

    expect(getSubmitReservationCheckoutLocale(input, "en-US")).toBe("cs-CZ");
  });

  test("rejects unsupported route locales", () => {
    const schema = getSubmitReservationSchema();

    expect(
      schema.safeParse({
        ...validSubmit,
        locale: "de-DE",
      }).success
    ).toBe(false);
  });

  test("accepts actual legal consent value for service enforcement", () => {
    const schema = getSubmitReservationSchema();

    expect(schema.parse({ ...validSubmit, legalConsent: false })).toEqual({
      ...validSubmit,
      legalConsent: false,
    });
    expect(
      schema.safeParse({
        locale: "en-US",
        payStateToken: "",
        legalConsent: true,
      }).success
    ).toBe(false);
  });
});

describe("reservation order schema", () => {
  test("does not include or require legal consent", () => {
    const schema = getReservationOrderSchema();

    expect(schema.parse(validReservation)).toEqual({
      entryTier: "basic",
      date: "2099-06-10",
      coffee: false,
      name: "Locale Test",
      email: "locale-test@example.com",
      phone: "+420777123463",
      message: "Locale propagation test",
    });
    expect(
      schema.safeParse({
        entryTier: "basic",
        date: "2099-06-10",
        coffee: false,
        name: "Locale Test",
        email: "locale-test@example.com",
      }).success
    ).toBe(false);
  });
});

describe("checkout legal snapshot locale", () => {
  test("uses English paths for English checkout creation", async () => {
    const documents = await getLegalAcceptanceSnapshot("en-US");

    expect(documents.termsAndConditions.path).toBe(
      "/en-US/terms-and-conditions"
    );
    expect(documents.operatingRules.path).toBe("/en-US/operating-rules");
    expect(documents.privacyPolicy.path).toBe("/en-US/privacy-policy");
  });

  test("uses Czech paths for Czech checkout creation", async () => {
    const documents = await getLegalAcceptanceSnapshot("cs-CZ");

    expect(documents.termsAndConditions.path).toBe(
      "/cs-CZ/terms-and-conditions"
    );
    expect(documents.operatingRules.path).toBe("/cs-CZ/operating-rules");
    expect(documents.privacyPolicy.path).toBe("/cs-CZ/privacy-policy");
  });
});

describe("prepare workspace Pay state early hold", () => {
  test("creates one local order and reuses the same Dotypos NEW hold for duplicate submit", async () => {
    setRequiredEnv();
    const prepare = await import("./prepare-pay-state");
    const paymentOrderRepository = await import(
      "@/features/checkout/backend/payment-order.repository"
    );
    const legalAuditRepository = await import(
      "@/features/checkout/backend/legal-evidence-audit.repository"
    );
    const reservationRecoveryRepository = await import(
      "@/features/checkout/backend/reservation-recovery.repository"
    );
    const availability = await import(
      "@/features/reservation/backend/workspace-availability.service"
    );
    const tableAssignment = await import(
      "@/features/checkout/backend/workspace-table-assignment.service"
    );
    const { checkoutDetailsJsonSchema } = await import(
      "@/features/checkout/schemas/checkout-details"
    );

    const orders: PaymentOrder[] = [];
    const createReservation = mock((input) =>
      Effect.succeed({
        id: "dotypos-hold-1",
        status: input.status,
        _customerId: input.customerId,
        _tableId: input.tableId,
      })
    );
    const createOrder = mock((input) => {
      const order = {
        id: input.id,
        provider: "nexi",
        dotyposCustomerId: input.dotyposCustomerId,
        correlationId: input.correlationId,
        checkoutDetails: checkoutDetailsJsonSchema.parse({
          ...input.checkoutDetails,
          fulfillment: { accessCodePolicy: "workspace-static-v1" },
        }),
        reservationSubmitKey: input.reservationSubmitKey ?? null,
        dotyposReservationId: null,
        dotyposReservationStatus: "none",
        securityToken: null,
        paymentStatus: "created",
        fulfillmentStatus: "not_started",
        lastWebhookEventId: null,
        lastProviderOperationId: null,
        lastProviderStatus: null,
        failureCode: null,
        paidAt: null,
        reservationCreatedAt: null,
        reservationHoldExpiresAt: input.reservationHoldExpiresAt ?? null,
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
        createdAt: new Date("2026-06-01T10:00:00.000Z"),
        updatedAt: new Date("2026-06-01T10:00:00.000Z"),
      };
      orders.push(order);
      return Effect.succeed(order);
    });

    const paymentOrders = {
      create: createOrder,
      findByReservationSubmitKey: mock((reservationSubmitKey) =>
        Effect.succeed(
          orders.find((order) => order.reservationSubmitKey === reservationSubmitKey) ??
            null
        )
      ),
      mergeLegalEvidence: mock(() => Effect.die("mergeLegalEvidence not used")),
      updateCheckoutDetails: mock((input) => {
        const index = orders.findIndex((order) => order.id === input.id);
        const order = orders[index];
        if (!order) return Effect.die("order not found");
        orders[index] = {
          ...order,
          checkoutDetails: {
            ...input.checkoutDetails,
            fulfillment: order.checkoutDetails.fulfillment,
          },
        };
        return Effect.succeed(orders[index]);
      }),
      deleteUnassociatedCreated: mock(() => Effect.void),
      attachNexiSession: mock(() => Effect.void),
      claimNexiSessionCreation: mock(() => Effect.succeed(true)),
      findById: mock((id) =>
        Effect.succeed(orders.find((order) => order.id === id) ?? null)
      ),
      markPaymentPending: mock(() => Effect.void),
      resetUnsuccessfulForRetry: mock(() =>
        Effect.die("resetUnsuccessfulForRetry not used")
      ),
      markPaid: mock(() => Effect.void),
      markFailed: mock(() => Effect.void),
      markCancelled: mock(() => Effect.void),
      markExpired: mock(() => Effect.void),
      markUnsuccessfulTerminal: mock(() => Effect.void),
      attachDotyposReservation: mock(() => Effect.void),
      claimReservationCreation: mock((id) =>
        Effect.succeed(
          orders.some((order, index) => {
            if (order.id !== id || order.dotyposReservationStatus !== "none") {
              return false;
            }
            orders[index] = {
              ...order,
              dotyposReservationStatus: "creating",
            };
            return true;
          })
        )
      ),
      releaseReservationCreation: mock(() => Effect.void),
      attachNewReservationHold: mock((input) => {
        const index = orders.findIndex((order) => order.id === input.id);
        const order = orders[index];
        if (!order || order.dotyposReservationStatus !== "creating") {
          return Effect.die("order is not creating");
        }
        orders[index] = {
          ...order,
          dotyposReservationId: input.dotyposReservationId,
          dotyposReservationStatus: "NEW",
          reservationCreatedAt: input.reservationCreatedAt,
        };
        return Effect.void;
      }),
      markReservationAttachCancellationPending: mock(() => Effect.void),
      claimReservationCancellation: mock(() => Effect.succeed(null)),
      markReservationCancelled: mock(() => Effect.void),
      markReservationCancellationFailed: mock(() => Effect.void),
      markReservationConfirmed: mock(() => Effect.void),
      selectExpiredReservationHolds: mock(() => Effect.succeed([])),
      claimPaidFulfillment: mock(() => Effect.succeed(null)),
      markCustomerAccessEmailSent: mock(() => Effect.succeed(true)),
      markInternalNotificationSent: mock(() => Effect.succeed(true)),
      markFulfilled: mock(() => Effect.succeed(true)),
      markFulfillmentFailed: mock(() => Effect.void),
    };

    const layer = Layer.mergeAll(
      Layer.succeed(
        paymentOrderRepository.PaymentOrderRepository,
        paymentOrders
      ),
      Layer.succeed(legalAuditRepository.LegalEvidenceAuditRepository, {
        recordRejected: mock(() => Effect.void),
      }),
      Layer.succeed(reservationRecoveryRepository.ReservationRecoveryRepository, {
        recordAttachFailure: mock(() => Effect.void),
      }),
      Layer.succeed(availability.WorkspaceAvailabilityService, {
        getAvailability: mock(() => Effect.die("getAvailability not used")),
        ensureAvailable: mock(() => Effect.void),
      }),
      Layer.succeed(tableAssignment.WorkspaceTableAssignmentService, {
        assignTableId: mock(() => Effect.succeed("workspace-table-1")),
      }),
      Layer.succeed(DotyposService, {
        createReservation,
        cancelReservation: mock(() => Effect.void),
        confirmReservation: mock(() => Effect.void),
        getReservation: mock(() => Effect.die("getReservation not used")),
        getCustomer: mock(() => Effect.die("getCustomer not used")),
        findCustomer: mock(() =>
          Effect.succeed({ _tag: "NotFound", matches: [] })
        ),
        findOrCreateCustomer: mock(() => Effect.succeed({ id: "customer-1" })),
        getCustomerDiscount: mock(() => Effect.succeed(undefined)),
        getTables: mock(() => Effect.die("getTables not used")),
        listReservations: mock(() => Effect.die("listReservations not used")),
        getProducts: mock(() => Effect.die("getProducts not used")),
        getCategories: mock(() => Effect.die("getCategories not used")),
      })
    );

    const input = {
      locale: "en-US",
      reservation: getReservationOrderSchema().parse(validReservation),
      legalConsent: true,
    };

    const first = await prepare.prepareWorkspacePayStateEffect(input).pipe(
      Effect.provide(layer),
      Effect.runPromise
    );
    const second = await prepare.prepareWorkspacePayStateEffect(input).pipe(
      Effect.provide(layer),
      Effect.runPromise
    );

    expect(first.status).toBe("ready");
    expect(second.status).toBe("ready");
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createReservation).toHaveBeenCalledTimes(1);
    expect(orders).toHaveLength(1);
    expect(orders[0]?.dotyposReservationId).toBe("dotypos-hold-1");
    expect(orders[0]?.dotyposReservationStatus).toBe("NEW");
  });
});
