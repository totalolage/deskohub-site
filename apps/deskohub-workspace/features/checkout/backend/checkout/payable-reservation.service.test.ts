import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import type { WorkspaceReservation } from "@/db/schema";
import {
  WorkspaceReservationRepository,
  type WorkspaceReservationRepository as WorkspaceReservationRepositoryType,
} from "@/features/reservation/backend/workspace-reservation.repository";
import { deriveCheckoutSessionKey } from "./checkout-session-key.server";
import {
  PayableReservationService,
  PayableReservationUnavailableError,
} from "./payable-reservation.service";

const checkoutSessionId = "checkout-session-id";
const checkoutSessionKey = deriveCheckoutSessionKey(checkoutSessionId);

const reservation = (overrides: Partial<WorkspaceReservation> = {}) =>
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
  }) as WorkspaceReservation;

const runRequireCurrent = (input: {
  readonly candidate?: WorkspaceReservation | null;
  readonly current?: WorkspaceReservation | null;
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
  } as unknown as WorkspaceReservationRepositoryType;
  const layer = PayableReservationService.Live.pipe(
    Layer.provide(
      Layer.merge(
        Layer.succeed(WorkspaceReservationRepository, repository),
        Layer.succeed(DotyposService, {
          getReservationStatus,
        } as unknown as typeof DotyposService.Service)
      )
    )
  );

  return {
    getReservationStatus,
    result: Effect.gen(function* () {
      const payable = yield* PayableReservationService;
      return yield* payable.requireCurrent({
        orderId: "reservation-id",
        checkoutSessionId: input.checkoutSessionId ?? checkoutSessionId,
      });
    }).pipe(Effect.provide(layer), Effect.runPromise),
  };
};

describe("PayableReservationService", () => {
  test("accepts the current held reservation only while Dotypos reports NEW", async () => {
    const { getReservationStatus, result } = runRequireCurrent({});

    await expect(result).resolves.toMatchObject({ id: "reservation-id" });
    expect(getReservationStatus).toHaveBeenCalledWith("dotypos-reservation-id");
  });

  test.each([
    "CANCELLED",
    "CONFIRMED",
  ] as const)("rejects a live Dotypos %s reservation", async (dotyposStatus) => {
    const { result } = runRequireCurrent({ dotyposStatus });

    await expect(result).rejects.toEqual(
      new PayableReservationUnavailableError({
        orderId: "reservation-id",
        reason: "dotypos_not_pending",
      })
    );
  });

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

  test.each([
    "hold_creation_candidate:synthetic-epoch:synthetic-provider:1780308000000",
    "hold_creation_candidate:synthetic-epoch:synthetic-provider:1780308000000:1780308120000",
    "hold_creation_candidate_compensating:synthetic-epoch:synthetic-provider:1780308000000",
    "hold_creation_orphan_recovery:synthetic-epoch:synthetic-loser",
    "hold_creation_orphan_processing:synthetic-epoch:synthetic-loser:synthetic-owner",
  ])("rejects unresolved provider attachment recovery before calling Dotypos", async (failureCode) => {
    const { getReservationStatus, result } = runRequireCurrent({
      candidate: reservation({ failureCode }),
    });

    await expect(result).rejects.toEqual(
      new PayableReservationUnavailableError({
        orderId: "reservation-id",
        reason: "unresolved_attachment_recovery",
      })
    );
    expect(getReservationStatus).not.toHaveBeenCalled();
  });
});
