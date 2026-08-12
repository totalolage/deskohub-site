import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import {
  WorkspaceCheckoutAccessCodeService,
  type WorkspaceCheckoutAccessCodeService as WorkspaceCheckoutAccessCodeServiceType,
} from "@/features/checkout/backend/reservation/access-code.service";
import type { Locale } from "@/features/i18n";
import { createReservationAccessToken } from "@/features/reservation/backend/reservation-access-token";
import {
  WorkspaceReservationRepository,
  type WorkspaceReservationRepository as WorkspaceReservationRepositoryType,
} from "@/features/reservation/backend/workspace-reservation.repository";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";

mock.module("server-only", () => ({}));

const now = Temporal.Instant.from("2026-06-20T08:00:00Z");
const orderId = workspaceReservationIdSchema.make("reservation-access-test");
const resolvedCode = ["fixture", "access"].join("-");

const makeReservation = (overrides: Record<string, unknown> = {}) => ({
  id: orderId,
  checkoutSessionKey: "session-key",
  checkoutAttemptKey: "attempt-key",
  correlationId: "correlation-id",
  dotyposCustomerId: "customer-id",
  dotyposReservationId: "provider-reservation-id",
  customerAccessCode: "legacy-code-not-read",
  reservationDetails: {
    kind: "cowork",
    entryTier: "basic",
    coffee: false,
  },
  productTier: "basic",
  productCoffee: false,
  productMonitorOption: null,
  locale: "en-US",
  reservationState: "confirmed",
  reservationHoldExpiresAt: null,
  reservationHoldExpiredAt: null,
  reservationCreatedAt: now.subtract({ hours: 24 }),
  reservationCancelledAt: null,
  paidAt: now.subtract({ hours: 1 }),
  fulfillmentState: "fulfilled",
  fulfilledAt: now.subtract({ hours: 1 }),
  fulfillmentFailedAt: null,
  reservationConfirmedAt: now.subtract({ hours: 1 }),
  paymentState: "paid",
  activePaymentAttemptId: null,
  failureCode: null,
  fulfillmentFailureCode: null,
  createdAt: now.subtract({ hours: 24 }),
  updatedAt: now.subtract({ hours: 1 }),
  ...overrides,
});

const makeProviderReservation = (overrides: Record<string, unknown> = {}) => ({
  reservation: {
    id: "provider-reservation-id",
    _customerId: "customer-id",
    startDate: "2026-06-20T08:15:00Z",
    endDate: "2026-06-20T09:00:00Z",
    seats: "1",
    status: "CONFIRMED",
    ...overrides,
  },
  customer: { id: "customer-id" },
});

type HarnessOptions = {
  readonly accessToken?: string;
  readonly inputLocale?: Locale;
  readonly reservation?: ReturnType<typeof makeReservation> | null;
  readonly reservationFails?: boolean;
  readonly providerReservation?: ReturnType<
    typeof makeProviderReservation
  > | null;
  readonly providerFails?: boolean;
  readonly resolver?: WorkspaceCheckoutAccessCodeServiceType["resolveCustomerAccessCode"];
};

const runAccess = async (options: HarnessOptions = {}) => {
  const { ReservationAccessService } = await import(
    "./reservation-access.service"
  );
  const findById = mock(() =>
    options.reservationFails
      ? Effect.fail(new Error("reservation lookup unavailable"))
      : Effect.succeed(
          options.reservation === undefined
            ? makeReservation()
            : options.reservation
        )
  );
  const getReservation = mock(() =>
    options.providerFails
      ? Effect.fail(new Error("provider unavailable"))
      : Effect.succeed(options.providerReservation ?? makeProviderReservation())
  );
  const resolveCustomerAccessCode = mock(
    options.resolver ?? (() => Effect.succeed(resolvedCode))
  );
  const reservations = {
    findById,
  } as unknown as WorkspaceReservationRepositoryType;
  const dotypos = {
    getReservation,
  } as unknown as typeof DotyposService.Service;
  const accessCodes: WorkspaceCheckoutAccessCodeServiceType = {
    generateCustomerAccessCode: Effect.succeed(resolvedCode),
    resolveCustomerAccessCode,
  };

  const access = await Effect.gen(function* () {
    yield* TestClock.setTime(now.epochMilliseconds);
    const service = yield* ReservationAccessService;
    return yield* service.getAccess({
      orderId,
      locale: options.inputLocale ?? "en-US",
      ...(options.accessToken ? { accessToken: options.accessToken } : {}),
    });
  }).pipe(
    Effect.provide(ReservationAccessService.Live),
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(WorkspaceReservationRepository, reservations),
        Layer.succeed(DotyposService, dotypos),
        Layer.succeed(WorkspaceCheckoutAccessCodeService, accessCodes),
        TestClock.layer()
      )
    ),
    Effect.runPromise
  );

  return { access, findById, getReservation, resolveCustomerAccessCode };
};

const createAccessToken = (
  expiresAt = now.add({ hours: 2 }),
  tokenOrderId = orderId,
  locale: Locale = "en-US"
) =>
  createReservationAccessToken({
    orderId: tokenOrderId,
    locale,
    expiresAt,
  }).pipe(Effect.runPromise);

describe("ReservationAccessService", () => {
  test("rejects missing, tampered, reservation-mismatched, and locale-mismatched capabilities before provider lookup", async () => {
    const validToken = await createAccessToken();
    const otherOrderToken = await createAccessToken(
      undefined,
      workspaceReservationIdSchema.make("another-reservation")
    );
    const otherLocaleToken = await createAccessToken(
      undefined,
      orderId,
      "cs-CZ"
    );
    const inputs = [
      undefined,
      `${validToken}tampered`,
      otherOrderToken,
      otherLocaleToken,
    ];

    for (const accessToken of inputs) {
      const result = await runAccess({ accessToken });

      expect(result.access).toEqual({ state: "unavailable" });
      expect(result.findById).not.toHaveBeenCalled();
      expect(result.getReservation).not.toHaveBeenCalled();
      expect(result.resolveCustomerAccessCode).not.toHaveBeenCalled();
    }
  });

  test("requires the route locale to match the stored reservation locale", async () => {
    const accessToken = await createAccessToken();
    const result = await runAccess({
      accessToken,
      reservation: makeReservation({ locale: "cs-CZ" }),
    });

    expect(result.access).toEqual({ state: "unavailable" });
    expect(result.getReservation).not.toHaveBeenCalled();
    expect(result.resolveCustomerAccessCode).not.toHaveBeenCalled();
  });

  test("fails closed when the local reservation is missing or cannot be read", async () => {
    const accessToken = await createAccessToken();

    for (const options of [
      { accessToken, reservation: null },
      { accessToken, reservationFails: true },
    ]) {
      const result = await runAccess(options);

      expect(result.access).toEqual({ state: "unavailable" });
      expect(result.getReservation).not.toHaveBeenCalled();
      expect(result.resolveCustomerAccessCode).not.toHaveBeenCalled();
    }
  });

  test("maps an authentic expired capability to ended without provider or code lookup", async () => {
    const accessToken = await createAccessToken(now);
    const result = await runAccess({ accessToken });

    expect(result.access).toEqual({ state: "ended" });
    expect(result.findById).toHaveBeenCalledTimes(1);
    expect(result.getReservation).not.toHaveBeenCalled();
    expect(result.resolveCustomerAccessCode).not.toHaveBeenCalled();
  });

  test.each([
    ["unpaid", { paymentState: "pending" }],
    ["not locally confirmed", { reservationState: "held" }],
    ["missing provider reservation id", { dotyposReservationId: null }],
  ] as const)("fails closed when the reservation is %s", async (_label, overrides) => {
    const accessToken = await createAccessToken();
    const result = await runAccess({
      accessToken,
      reservation: makeReservation(overrides),
    });

    expect(result.access).toEqual({ state: "unavailable" });
    expect(result.getReservation).not.toHaveBeenCalled();
    expect(result.resolveCustomerAccessCode).not.toHaveBeenCalled();
  });

  test("fails closed when the provider is unavailable, cancelled, or returns invalid timing", async () => {
    const accessToken = await createAccessToken();
    const cases: readonly HarnessOptions[] = [
      { accessToken, providerFails: true },
      {
        accessToken,
        providerReservation: makeProviderReservation({ status: "CANCELLED" }),
      },
      {
        accessToken,
        providerReservation: makeProviderReservation({
          startDate: "invalid-start",
        }),
      },
    ];

    for (const options of cases) {
      const result = await runAccess(options);
      expect(result.access).toEqual({ state: "unavailable" });
      expect(result.resolveCustomerAccessCode).not.toHaveBeenCalled();
    }
  });

  test("returns the upcoming display window without resolving a code", async () => {
    const accessToken = await createAccessToken();
    const result = await runAccess({
      accessToken,
      providerReservation: makeProviderReservation({
        startDate: "2026-06-20T09:00:00Z",
        endDate: "2026-06-20T10:00:00Z",
      }),
    });

    expect(result.access).toEqual({
      state: "upcoming",
      availableAt: Temporal.Instant.from("2026-06-20T08:30:00Z"),
      unavailableAt: Temporal.Instant.from("2026-06-20T10:30:00Z"),
    });
    expect(result.resolveCustomerAccessCode).not.toHaveBeenCalled();
  });

  test("resolves the current code only inside the display window", async () => {
    const accessToken = await createAccessToken();
    const result = await runAccess({ accessToken });

    expect(result.access).toEqual({
      state: "available",
      code: resolvedCode,
      unavailableAt: Temporal.Instant.from("2026-06-20T09:30:00Z"),
    });
    expect(result.resolveCustomerAccessCode).toHaveBeenCalledTimes(1);
    expect(result.resolveCustomerAccessCode).toHaveBeenCalledWith({
      reservationId: orderId,
      dotyposReservationId: "provider-reservation-id",
      reservedFrom: Temporal.Instant.from("2026-06-20T08:15:00Z"),
      reservedUntil: Temporal.Instant.from("2026-06-20T09:00:00Z"),
    });
  });

  test("returns ended after the display window without resolving a code", async () => {
    const accessToken = await createAccessToken(now.add({ hours: 4 }));
    const result = await runAccess({
      accessToken,
      providerReservation: makeProviderReservation({
        startDate: "2026-06-20T06:00:00Z",
        endDate: "2026-06-20T07:00:00Z",
      }),
    });

    expect(result.access).toEqual({ state: "ended" });
    expect(result.resolveCustomerAccessCode).not.toHaveBeenCalled();
  });

  test("fails closed when code resolution fails or returns an empty value", async () => {
    const accessToken = await createAccessToken();
    const resolvers = [
      () => Effect.fail(new Error("resolver unavailable")),
      () => Effect.succeed(""),
    ];

    for (const resolver of resolvers) {
      const result = await runAccess({
        accessToken,
        resolver:
          resolver as WorkspaceCheckoutAccessCodeServiceType["resolveCustomerAccessCode"],
      });

      expect(result.access).toEqual({ state: "unavailable" });
    }
  });
});
