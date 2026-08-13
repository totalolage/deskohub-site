import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { WorkspacePaidFulfillmentService } from "@/features/checkout/backend/fulfillment/paid-fulfillment.service";
import {
  WorkspaceReservationDetailsError,
  WorkspaceReservationService,
} from "@/features/reservation/backend/workspace-reservation.service";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import {
  type ReservationAccessGrant,
  ReservationAccessService,
} from "@/features/reservation-access";
import {
  ReservationAccessAdministration,
  ReservationAccessAdministrationError,
} from "./reservation-access-administration.service";

const reservationId = workspaceReservationIdSchema.make("reservation-id");
const baseGrant = {
  id: "grant-id",
  reservationId,
  provider: "igloohome",
  credentialType: "algopin_hourly",
  deviceId: "EK1",
  state: "failed",
  providerCredentialId: null,
  scheduledAccessStartsAt: Temporal.Instant.from("2099-07-01T08:00:00Z"),
  accessStartsAt: Temporal.Instant.from("2099-07-01T08:00:00Z"),
  accessEndsAt: Temporal.Instant.from("2099-07-01T16:00:00Z"),
  provisioningStartedAt: null,
  issuedAt: null,
  failedAt: Temporal.Instant.from("2099-06-01T08:00:00Z"),
  failureCode: "provider_request_rejected",
  createdAt: Temporal.Instant.from("2099-06-01T08:00:00Z"),
  updatedAt: Temporal.Instant.from("2099-06-01T08:00:00Z"),
} as ReservationAccessGrant;

const reservation = {
  id: reservationId,
  dotyposCustomerId: "customer-id",
  dotyposReservationId: "dotypos-id",
  reservationDetails: { kind: "cowork" as const },
  locale: "en-US" as const,
  customer: {},
  reservedFrom: baseGrant.accessStartsAt,
  reservedUntil: baseGrant.accessEndsAt,
  seats: 1,
};

const runMutation = (
  mutation: Parameters<ReservationAccessAdministration["Service"]["mutate"]>[0],
  grant: ReservationAccessGrant = baseGrant,
  fulfillment = Effect.void,
  target = Effect.succeed(reservation),
  resume = false
) => {
  const issueForReservation = mock(() =>
    Effect.succeed({
      grantId: grant.id,
      accessCode: "1".repeat(7),
      accessStartsAt: grant.accessStartsAt,
      accessEndsAt: grant.accessEndsAt,
    } as never)
  );
  const fulfillPaidOrder = mock(() => fulfillment);
  const confirmProviderCredentialRemoved = mock(() =>
    Effect.succeed({ ...grant, state: "failed" as const })
  );
  let loadCount = 0;
  const loadGrant = mock(() =>
    Effect.succeed(
      loadCount++ === 0 ? grant : { ...grant, state: "issued" as const }
    )
  );

  return {
    issueForReservation,
    fulfillPaidOrder,
    confirmProviderCredentialRemoved,
    result: Effect.gen(function* () {
      const administration = yield* ReservationAccessAdministration;
      return yield* resume
        ? administration.resumeInterruptedMutation(mutation.reservationId)
        : administration.mutate(mutation);
    }).pipe(
      Effect.provide(
        ReservationAccessAdministration.Live.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ReservationAccessService, {
                loadGrant,
                issueForReservation,
                confirmProviderCredentialRemoved,
              }),
              Layer.mock(WorkspaceReservationService, {
                getAccessTarget: mock(() => target),
              }),
              Layer.mock(WorkspacePaidFulfillmentService, {
                fulfillPaidOrder,
              })
            )
          )
        )
      ),
      Effect.runPromise
    ),
  };
};

describe("ReservationAccessAdministration", () => {
  test("retries a definitively failed grant through current reservation timing and fulfillment", async () => {
    const harness = runMutation({ kind: "retry-failed", reservationId });

    expect((await harness.result).state).toBe("issued");
    expect(harness.issueForReservation).toHaveBeenCalledWith({
      reservationId,
      reservedFrom: reservation.reservedFrom,
      reservedUntil: reservation.reservedUntil,
    });
    expect(harness.fulfillPaidOrder).toHaveBeenCalledWith({
      orderId: reservationId,
    });
    expect(harness.confirmProviderCredentialRemoved).not.toHaveBeenCalled();
  });

  test("requires provider removal confirmation before retrying uncertain access", async () => {
    const uncertain = { ...baseGrant, state: "uncertain" as const };
    const rejected = runMutation(
      { kind: "retry-failed", reservationId },
      uncertain
    );

    await expect(rejected.result).rejects.toBeInstanceOf(
      ReservationAccessAdministrationError
    );
    expect(rejected.issueForReservation).not.toHaveBeenCalled();

    const confirmed = runMutation(
      {
        kind: "confirm-provider-credential-removed",
        providerCredentialRemoved: true,
        reservationId,
      },
      uncertain
    );
    expect((await confirmed.result).state).toBe("issued");
    expect(confirmed.confirmProviderCredentialRemoved).toHaveBeenCalledWith(
      reservationId
    );
  });

  test("returns issued access for a repeated recovery request", async () => {
    const harness = runMutation(
      { kind: "retry-failed", reservationId },
      { ...baseGrant, state: "issued" }
    );

    expect((await harness.result).state).toBe("issued");
    expect(harness.issueForReservation).not.toHaveBeenCalled();
  });

  test("allows reconciliation only after a provisioning claim is stale", async () => {
    const fresh = runMutation(
      {
        kind: "confirm-provider-credential-removed",
        providerCredentialRemoved: true,
        reservationId,
      },
      {
        ...baseGrant,
        state: "provisioning",
        provisioningStartedAt: Temporal.Now.instant(),
      }
    );
    await expect(fresh.result).rejects.toMatchObject({
      reason: "invalid_state",
    });
    expect(fresh.confirmProviderCredentialRemoved).not.toHaveBeenCalled();

    const stale = runMutation(
      {
        kind: "confirm-provider-credential-removed",
        providerCredentialRemoved: true,
        reservationId,
      },
      {
        ...baseGrant,
        state: "provisioning",
        provisioningStartedAt: Temporal.Now.instant().subtract({ minutes: 2 }),
      }
    );
    expect((await stale.result).state).toBe("issued");
    expect(stale.confirmProviderCredentialRemoved).toHaveBeenCalledWith(
      reservationId
    );
  });

  test("reports issued access when later fulfillment recovery fails", async () => {
    const harness = runMutation(
      { kind: "retry-failed", reservationId },
      baseGrant,
      Effect.fail(new Error("email unavailable"))
    );

    expect((await harness.result).state).toBe("issued");
    expect(harness.fulfillPaidOrder).toHaveBeenCalledWith({
      orderId: reservationId,
    });
  });

  test("classifies failures before issuance as safe to retry", async () => {
    const harness = runMutation(
      { kind: "retry-failed", reservationId },
      baseGrant,
      Effect.void,
      Effect.fail(new Error("Dotypos unavailable"))
    );

    await expect(harness.result).rejects.toMatchObject({
      reason: "retryable_failure",
    });
    expect(harness.issueForReservation).not.toHaveBeenCalled();
  });

  test("classifies permanently ineligible reservations as invalid", async () => {
    const harness = runMutation(
      { kind: "retry-failed", reservationId },
      baseGrant,
      Effect.void,
      Effect.fail(
        new WorkspaceReservationDetailsError({
          reservationId,
          errorCode: "reservation_access_unavailable",
          message: "Reservation access is not available for recovery.",
        })
      )
    );

    await expect(harness.result).rejects.toMatchObject({
      reason: "invalid_state",
    });
    expect(harness.issueForReservation).not.toHaveBeenCalled();
  });

  test("resumes interrupted requests only from safe grant states", async () => {
    const failed = runMutation(
      { kind: "retry-failed", reservationId },
      baseGrant,
      Effect.void,
      Effect.succeed(reservation),
      true
    );
    expect((await failed.result).state).toBe("issued");
    expect(failed.issueForReservation).toHaveBeenCalledTimes(1);

    const uncertain = runMutation(
      { kind: "retry-failed", reservationId },
      { ...baseGrant, state: "uncertain" },
      Effect.void,
      Effect.succeed(reservation),
      true
    );
    await expect(uncertain.result).rejects.toMatchObject({
      reason: "invalid_state",
    });
    expect(uncertain.issueForReservation).not.toHaveBeenCalled();
  });
});
