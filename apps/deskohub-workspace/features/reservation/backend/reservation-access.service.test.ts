import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { type DotyposReservation, DotyposService } from "@deskohub/dotypos";
import { Effect, Layer, Option } from "effect";
import {
  WorkspaceCheckoutAccessCodeService,
  type WorkspaceCheckoutAccessCodeService as WorkspaceCheckoutAccessCodeServiceType,
} from "@/features/checkout/backend/reservation/access-code.service";
import type { Locale } from "@/features/i18n";
import {
  createReservationAccessToken,
  openReservationAccessToken,
} from "@/features/reservation/backend/reservation-access-token";
import {
  type ReservationAuthorizationInput,
  ReservationAuthorizationService,
} from "@/features/reservation/backend/reservation-authorization.service";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import type { ReservationAccessToken } from "@/features/reservation/reservation-access-token";

mock.module("server-only", () => ({}));

const now = Temporal.Instant.from("2026-06-20T08:00:00Z");
const orderId = workspaceReservationIdSchema.make("reservation-access-test");
const resolvedCode = ["fixture", "access"].join("-");
const resolvedAccess = {
  code: resolvedCode,
  accessStartsAt: Temporal.Instant.from("2026-06-20T08:00:00Z"),
  accessEndsAt: Temporal.Instant.from("2026-06-20T09:00:00Z"),
};

type ReservationOverrides = Partial<
  Pick<
    WorkspaceReservation,
    "dotyposReservationId" | "locale" | "paymentState" | "reservationState"
  >
>;

const makeReservation = (overrides: ReservationOverrides = {}) => ({
  id: orderId,
  checkoutSessionKey: "session-key",
  checkoutAttemptKey: "attempt-key",
  correlationId: "correlation-id",
  dotyposCustomerId: "customer-id",
  dotyposReservationId: "provider-reservation-id",
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

type ProviderReservationOverrides = Partial<
  Pick<DotyposReservation, "endDate" | "startDate" | "status">
>;

const makeProviderReservation = (
  overrides: ProviderReservationOverrides = {}
) => ({
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
  readonly accessToken?: ReservationAccessToken;
  readonly authorized?: boolean;
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
  const isAuthorized = mock((input: ReservationAuthorizationInput) => {
    if (options.authorized !== undefined) {
      return Effect.succeed(options.authorized);
    }
    if (!input.accessToken) return Effect.succeed(false);
    return openReservationAccessToken({
      token: input.accessToken,
      orderId: input.orderId,
      locale: input.locale,
    }).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false)
    );
  });
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
      : Effect.succeed(
          Option.some(options.providerReservation ?? makeProviderReservation())
        )
  );
  const resolveCustomerAccessCode = mock(
    options.resolver ?? (() => Effect.succeed(resolvedAccess))
  );
  const accessCodes: WorkspaceCheckoutAccessCodeServiceType = {
    resolveCustomerAccessCode,
  };

  const access = await Effect.gen(function* () {
    const service = yield* ReservationAccessService;
    return yield* service.getAccess({
      orderId,
      locale: options.inputLocale ?? "en-US",
      accessToken: options.accessToken,
    });
  }).pipe(
    Effect.provide(ReservationAccessService.Default),
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(WorkspaceReservationRepository, { findById }),
        Layer.mock(DotyposService, { getReservation }),
        Layer.succeed(WorkspaceCheckoutAccessCodeService, accessCodes),
        Layer.succeed(ReservationAuthorizationService, { isAuthorized })
      )
    ),
    Effect.runPromise
  );

  return {
    access,
    findById,
    getReservation,
    isAuthorized,
    resolveCustomerAccessCode,
  };
};

const createAccessToken = () =>
  createReservationAccessToken({
    orderId,
    locale: "en-US",
  }).pipe(Effect.runPromise);

describe("ReservationAccessService", () => {
  test("returns an invalid-link state without reads when the request is not authorized", async () => {
    const result = await runAccess({ authorized: false });

    expect(result.access).toEqual({ state: "invalid_link" });
    expect(result.findById).not.toHaveBeenCalled();
    expect(result.getReservation).not.toHaveBeenCalled();
    expect(result.resolveCustomerAccessCode).not.toHaveBeenCalled();
  });

  test("asks for the access-code permission, not the status permission", async () => {
    const result = await runAccess({ authorized: false });

    expect(result.isAuthorized).toHaveBeenCalledWith(
      expect.objectContaining({ orderId, permission: "view-access-code" })
    );
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

  test.each([
    ["unpaid", { paymentState: "pending" }],
    ["not locally confirmed", { reservationState: "held" }],
    ["missing provider reservation id", { dotyposReservationId: null }],
  ] as const)(
    "fails closed when the reservation is %s",
    async (_label, overrides) => {
      const accessToken = await createAccessToken();
      const result = await runAccess({
        accessToken,
        reservation: makeReservation(overrides),
      });

      expect(result.access).toEqual({ state: "unavailable" });
      expect(result.getReservation).not.toHaveBeenCalled();
      expect(result.resolveCustomerAccessCode).not.toHaveBeenCalled();
    }
  );

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

  test("resolves the current code without a local display window", async () => {
    const accessToken = await createAccessToken();
    const result = await runAccess({ accessToken });

    expect(result.access).toEqual({
      state: "available",
      ...resolvedAccess,
    });
    expect(result.resolveCustomerAccessCode).toHaveBeenCalledTimes(1);
    expect(result.resolveCustomerAccessCode).toHaveBeenCalledWith({
      reservationId: orderId,
      dotyposReservationId: "provider-reservation-id",
      reservedFrom: Temporal.Instant.from("2026-06-20T08:15:00Z"),
      reservedUntil: Temporal.Instant.from("2026-06-20T09:00:00Z"),
    });
  });

  test("resolves the code after its provider interval", async () => {
    const accessToken = await createAccessToken();
    const result = await runAccess({
      accessToken,
      providerReservation: makeProviderReservation({
        startDate: "2026-06-20T06:00:00Z",
        endDate: "2026-06-20T07:00:00Z",
      }),
    });

    expect(result.access).toEqual({ state: "available", ...resolvedAccess });
    expect(result.resolveCustomerAccessCode).toHaveBeenCalledWith({
      reservationId: orderId,
      dotyposReservationId: "provider-reservation-id",
      reservedFrom: Temporal.Instant.from("2026-06-20T06:00:00Z"),
      reservedUntil: Temporal.Instant.from("2026-06-20T07:00:00Z"),
    });
  });

  test("fails closed when code resolution fails or returns an empty value", async () => {
    const accessToken = await createAccessToken();
    const resolvers = [
      () => Effect.fail(new Error("resolver unavailable")),
      () => Effect.succeed({ ...resolvedAccess, code: "" }),
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
