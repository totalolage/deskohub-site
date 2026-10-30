import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { ConfigProvider, Effect, Layer } from "effect";
import type { WorkspaceReservationRow } from "@/db/schema";
import {
  type CheckoutSessionKey,
  checkoutSessionIdSchema,
} from "@/features/checkout/checkout-identifiers";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { deriveCheckoutSessionKeys } from "./checkout-lookup-keys.server";
import { findKeyIdPrefixedLookupKey } from "./checkout-lookup-keys.test-utils";
import {
  PayableReservationService,
  PayableReservationUnavailableError,
} from "./payable-reservation.service";

const checkoutSessionId = checkoutSessionIdSchema.make("checkout-session-id");
const keyRing = `original:${Buffer.alloc(32, 1).toString("base64url")}`;

const withKeyRing = Effect.provideService(
  ConfigProvider.ConfigProvider,
  ConfigProvider.fromUnknown({ CHECKOUT_PAY_STATE_KEYS: keyRing })
);

// New rows store the active key's prefixed derivation.
const checkoutSessionKey: CheckoutSessionKey = findKeyIdPrefixedLookupKey(
  deriveCheckoutSessionKeys(checkoutSessionId).pipe(
    withKeyRing,
    Effect.runSync
  ),
  "original"
);

const reservation = (overrides: Partial<WorkspaceReservationRow> = {}) =>
  ({
    id: "reservation-id",
    checkoutSessionKey,
    checkoutAttemptKey: "checkout-attempt-key",
    reservationState: "held",
    paymentState: "not_started",
    fulfillmentState: "not_started",
    dotyposReservationId: "dotypos-reservation-id",
    reservationHoldExpiresAt: Temporal.Instant.from("2030-07-22T12:00:00Z"),
    ...overrides,
  }) as WorkspaceReservationRow;

const runRequireCurrent = (input: {
  readonly candidate?: WorkspaceReservationRow | null;
  readonly current?: WorkspaceReservationRow | null;
  readonly dotyposStatus?: "NEW" | "CANCELLED" | "CONFIRMED";
  readonly checkoutSessionId?: string;
}) => {
  const candidate =
    input.candidate === undefined ? reservation() : input.candidate;
  const current = input.current === undefined ? candidate : input.current;
  const getReservationStatus = mock(() =>
    Effect.succeed(input.dotyposStatus ?? "NEW")
  );
  const repository = {
    findById: mock(() => Effect.succeed(candidate)),
    findCurrentByCheckoutSessionKey: mock(() => Effect.succeed(current)),
  };
  const layer = PayableReservationService.Default.pipe(
    Layer.provide(
      Layer.merge(
        Layer.mock(WorkspaceReservationRepository, repository),
        Layer.mock(DotyposService, {
          getReservationStatus,
        })
      )
    )
  );

  return {
    getReservationStatus,
    result: Effect.gen(function* () {
      const payable = yield* PayableReservationService;
      return yield* payable.requireCurrent({
        orderId: "reservation-id",
        checkoutSessionId: checkoutSessionIdSchema.make(
          input.checkoutSessionId ?? checkoutSessionId
        ),
      });
    }).pipe(Effect.provide(layer), withKeyRing, Effect.runPromise),
  };
};

describe("PayableReservationService", () => {
  test("accepts the current held reservation only while Dotypos reports NEW", async () => {
    const { getReservationStatus, result } = runRequireCurrent({});

    await expect(result).resolves.toMatchObject({ id: "reservation-id" });
    expect(getReservationStatus).toHaveBeenCalledWith("dotypos-reservation-id");
  });

  test.each(["CANCELLED", "CONFIRMED"] as const)(
    "rejects a live Dotypos %s reservation",
    async (dotyposStatus) => {
      const { result } = runRequireCurrent({ dotyposStatus });

      await expect(result).rejects.toEqual(
        new PayableReservationUnavailableError({
          orderId: "reservation-id",
          reason: "dotypos_not_pending",
        })
      );
    }
  );

  test("rejects a superseded local reservation without calling Dotypos", async () => {
    const { getReservationStatus, result } = runRequireCurrent({
      current: reservation({ id: "replacement-reservation-id" }),
    });

    await expect(result).rejects.toEqual(
      new PayableReservationUnavailableError({
        orderId: "reservation-id",
        reason: "not_current",
      })
    );
    expect(getReservationStatus).not.toHaveBeenCalled();
  });

  test("rejects a reservation from another checkout session", async () => {
    const { getReservationStatus, result } = runRequireCurrent({
      checkoutSessionId: "other-checkout-session-id",
    });

    await expect(result).rejects.toEqual(
      new PayableReservationUnavailableError({
        orderId: "reservation-id",
        reason: "not_current",
      })
    );
    expect(getReservationStatus).not.toHaveBeenCalled();
  });
});
