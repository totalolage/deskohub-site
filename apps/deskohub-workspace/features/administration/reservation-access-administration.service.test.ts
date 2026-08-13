import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { WorkspacePaidFulfillmentService } from "@/features/checkout/backend/fulfillment/paid-fulfillment.service";
import { WorkspaceReservationService } from "@/features/reservation/backend/workspace-reservation.service";
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
  grant: ReservationAccessGrant = baseGrant
) => {
  const issueForReservation = mock(() =>
    Effect.succeed({
      grantId: grant.id,
      accessCode: "1".repeat(7),
      accessStartsAt: grant.accessStartsAt,
      accessEndsAt: grant.accessEndsAt,
    } as never)
  );
  const fulfillPaidOrder = mock(() => Effect.void);
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
      return yield* administration.mutate(mutation);
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
                getAccessTarget: mock(() => Effect.succeed(reservation)),
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
});
