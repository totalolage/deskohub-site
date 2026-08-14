import "@/shared/testing/workspace-test-env";

import { expect, mock, test } from "bun:test";
import { AlgoPinSchema } from "@deskohub/igloohome";
import { Effect, Schema } from "effect";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { ReservationAccessService as ReservationAccessProvisioningService } from "@/features/reservation-access";
import { reservationAccessGrantIdSchema } from "@/features/reservation-access/reservation-access";
import { WorkspaceCheckoutAccessCodeService } from "./access-code.service";

test("resolves the reservation AlgoPIN through the dynamic access provider", async () => {
  const reservationId = Schema.decodeUnknownSync(workspaceReservationIdSchema)(
    "reservation-id"
  );
  const accessCode = Schema.decodeUnknownSync(AlgoPinSchema)("7654321");
  const reservedFrom = Temporal.Instant.from("2099-07-01T08:00:00Z");
  const reservedUntil = Temporal.Instant.from("2099-07-01T16:00:00Z");
  const issueForReservation = mock(() =>
    Effect.succeed({
      grantId: Schema.decodeUnknownSync(reservationAccessGrantIdSchema)(
        "reservation-access-grant-id"
      ),
      accessCode,
      accessStartsAt: reservedFrom,
      accessEndsAt: reservedUntil,
    })
  );

  const result = await Effect.gen(function* () {
    const service = yield* WorkspaceCheckoutAccessCodeService;
    return yield* service.resolveCustomerAccessCode({
      reservationId,
      dotyposReservationId: "dotypos-reservation-id",
      reservedFrom,
      reservedUntil,
    });
  }).pipe(
    Effect.provide(WorkspaceCheckoutAccessCodeService.Live),
    Effect.provideService(
      ReservationAccessProvisioningService,
      ReservationAccessProvisioningService.of({ issueForReservation })
    ),
    Effect.runPromise
  );

  expect(result).toEqual({
    code: accessCode,
    accessStartsAt: reservedFrom,
    accessEndsAt: reservedUntil,
  });
  expect(issueForReservation).toHaveBeenCalledWith({
    reservationId,
    reservedFrom,
    reservedUntil,
  });
});
