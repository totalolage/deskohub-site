import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import {
  AlgoPinSchema,
  IgloohomeDeviceIdSchema,
  IgloohomePinIdSchema,
  IgloohomeRequestError,
  IgloohomeService,
} from "@deskohub/igloohome";
import { Effect, Layer, Result, Schema } from "effect";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { reservationAccessGrantIdSchema } from "../reservation-access";
import { ReservationAccessRepository } from "./reservation-access.repository";
import {
  getReservationAccessInterval,
  ReservationAccessService,
} from "./reservation-access.service";

const reservationId = Schema.decodeUnknownSync(workspaceReservationIdSchema)(
  "reservation-access-test"
);
const grantId = Schema.decodeUnknownSync(reservationAccessGrantIdSchema)(
  "reservation-access-grant-test"
);
const deviceId = Schema.decodeUnknownSync(IgloohomeDeviceIdSchema)(
  "fixture-ek1"
);
const otherDeviceId = Schema.decodeUnknownSync(IgloohomeDeviceIdSchema)(
  "fixture-other-ek1"
);
const accessCode = Schema.decodeUnknownSync(AlgoPinSchema)("7654321");
const pinId = Schema.decodeUnknownSync(IgloohomePinIdSchema)("pin-id");
const replacementAccessCode =
  Schema.decodeUnknownSync(AlgoPinSchema)("8765432");
const replacementPinId =
  Schema.decodeUnknownSync(IgloohomePinIdSchema)("replacement-pin-id");

describe("reservation access interval", () => {
  test("preserves Prague offsets and exact elapsed duration", () => {
    const interval = Effect.runSync(
      getReservationAccessInterval({
        reservationId,
        reservedFrom: Temporal.Instant.from("2026-10-23T22:00:00Z"),
        reservedUntil: Temporal.Instant.from("2026-10-25T23:00:00Z"),
        now: Temporal.Instant.from("2026-10-01T10:12:00Z"),
      })
    );

    expect(interval.providerStartsAt).toBe("2026-10-24T00:00:00+02:00");
    expect(interval.providerEndsAt).toBe("2026-10-26T00:00:00+01:00");
    expect(
      (interval.endsAt.epochMilliseconds -
        interval.startsAt.epochMilliseconds) /
        3_600_000
    ).toBe(49);
  });

  test("uses the current Prague hour after a reservation has started", () => {
    const interval = Effect.runSync(
      getReservationAccessInterval({
        reservationId,
        reservedFrom: Temporal.Instant.from("2026-07-01T08:00:00Z"),
        reservedUntil: Temporal.Instant.from("2026-07-01T14:00:00Z"),
        now: Temporal.Instant.from("2026-07-01T10:37:00Z"),
      })
    );

    expect(interval.providerStartsAt).toBe("2026-07-01T12:00:00+02:00");
    expect(interval.providerEndsAt).toBe("2026-07-01T16:00:00+02:00");
  });

  test("records the exact early-setup interval and its rounded provider window", () => {
    const interval = Effect.runSync(
      getReservationAccessInterval({
        reservationId,
        reservedFrom: Temporal.Instant.from("2099-07-01T07:45:00Z"),
        reservedUntil: Temporal.Instant.from("2099-07-01T09:00:00Z"),
        now: Temporal.Instant.from("2099-07-01T07:20:00Z"),
      })
    );

    expect(interval.scheduledStartsAt.toString()).toBe("2099-07-01T07:45:00Z");
    expect(interval.startsAt.toString()).toBe("2099-07-01T07:45:00Z");
    expect(interval.endsAt.toString()).toBe("2099-07-01T09:00:00Z");
    expect(interval.providerStartsAt).toBe("2099-07-01T09:00:00+02:00");
    expect(interval.providerEndsAt).toBe("2099-07-01T11:00:00+02:00");
  });

  test("keeps the exact early-setup interval when issued after setup begins", () => {
    const interval = Effect.runSync(
      getReservationAccessInterval({
        reservationId,
        reservedFrom: Temporal.Instant.from("2099-07-01T07:45:00Z"),
        reservedUntil: Temporal.Instant.from("2099-07-01T09:00:00Z"),
        now: Temporal.Instant.from("2099-07-01T08:20:00Z"),
      })
    );

    expect(interval.scheduledStartsAt.toString()).toBe("2099-07-01T07:45:00Z");
    expect(interval.startsAt.toString()).toBe("2099-07-01T07:45:00Z");
    expect(interval.endsAt.toString()).toBe("2099-07-01T09:00:00Z");
    expect(interval.providerStartsAt).toBe("2099-07-01T10:00:00+02:00");
    expect(interval.providerEndsAt).toBe("2099-07-01T11:00:00+02:00");
  });

  test("accepts 672 hours and rejects 673 hours", () => {
    const startsAt = Temporal.Instant.from("2026-01-01T00:00:00Z");
    const accepted = Effect.runSync(
      getReservationAccessInterval({
        reservationId,
        reservedFrom: startsAt,
        reservedUntil: startsAt.add({ hours: 672 }),
        now: startsAt.subtract({ hours: 1 }),
      }).pipe(Effect.result)
    );
    const rejected = Effect.runSync(
      getReservationAccessInterval({
        reservationId,
        reservedFrom: startsAt,
        reservedUntil: startsAt.add({ hours: 673 }),
        now: startsAt.subtract({ hours: 1 }),
      }).pipe(Effect.result)
    );
    const rejectedAfterRounding = Effect.runSync(
      getReservationAccessInterval({
        reservationId,
        reservedFrom: startsAt.add({ minutes: 30 }),
        reservedUntil: startsAt.add({ hours: 672, minutes: 30 }),
        now: startsAt.subtract({ hours: 1 }),
      }).pipe(Effect.result)
    );

    expect(Result.isSuccess(accepted)).toBe(true);
    expect(Result.isFailure(rejected)).toBe(true);
    expect(Result.isFailure(rejectedAfterRounding)).toBe(true);
  });

  test("rounds reservation boundaries outward to Prague hours", () => {
    const interval = Effect.runSync(
      getReservationAccessInterval({
        reservationId,
        reservedFrom: Temporal.Instant.from("2026-07-01T08:30:00Z"),
        reservedUntil: Temporal.Instant.from("2026-07-01T10:15:00Z"),
        now: Temporal.Instant.from("2026-07-01T07:00:00Z"),
      })
    );

    expect(interval.providerStartsAt).toBe("2026-07-01T10:00:00+02:00");
    expect(interval.providerEndsAt).toBe("2026-07-01T13:00:00+02:00");
  });

  test("rejects an ended reservation before rounding its end forward", () => {
    const result = Effect.runSync(
      getReservationAccessInterval({
        reservationId,
        reservedFrom: Temporal.Instant.from("2026-07-01T08:10:00Z"),
        reservedUntil: Temporal.Instant.from("2026-07-01T08:50:00Z"),
        now: Temporal.Instant.from("2026-07-01T08:55:00Z"),
      }).pipe(Effect.result)
    );

    expect(Result.isFailure(result)).toBe(true);
  });
});

interface ScheduledBounds {
  readonly scheduledAccessStartsAt: Temporal.Instant;
  readonly accessStartsAt: Temporal.Instant;
  readonly accessEndsAt: Temporal.Instant;
}

const formatBounds = (bounds: ScheduledBounds | undefined) => ({
  scheduledAccessStartsAt: bounds?.scheduledAccessStartsAt.toString(),
  accessStartsAt: bounds?.accessStartsAt.toString(),
  accessEndsAt: bounds?.accessEndsAt.toString(),
});

describe("ReservationAccessService", () => {
  const reservation = {
    reservationId,
    reservedFrom: Temporal.Instant.from("2099-07-01T08:00:00Z"),
    reservedUntil: Temporal.Instant.from("2099-07-01T16:00:00Z"),
  };

  const grant = {
    id: grantId,
    reservationId,
    deviceId,
    state: "issued" as const,
    providerCredentialId: pinId,
    accessName: `Deskohub ${grantId}`,
    scheduledAccessStartsAt: reservation.reservedFrom,
    accessStartsAt: reservation.reservedFrom,
    accessEndsAt: reservation.reservedUntil,
    provisioningStartedAt: Temporal.Instant.from("2099-07-01T07:00:00Z"),
    issuedAt: Temporal.Instant.from("2099-07-01T07:00:01Z"),
    failedAt: null,
    failureCode: null,
    updatedAt: Temporal.Instant.from("2099-07-01T07:00:01Z"),
  };

  test("reuses an issued credential without calling Igloohome", async () => {
    const pastReservation = {
      reservationId,
      reservedFrom: Temporal.Instant.from("2020-07-01T08:00:00Z"),
      reservedUntil: Temporal.Instant.from("2020-07-01T16:00:00Z"),
    };
    const pastGrant = {
      ...grant,
      scheduledAccessStartsAt: pastReservation.reservedFrom,
      accessStartsAt: pastReservation.reservedFrom,
      accessEndsAt: pastReservation.reservedUntil,
    };
    const issueHourlyAlgoPin = mock(() =>
      Effect.die("Igloohome must not be called")
    );
    const ensure = mock(() => Effect.succeed(pastGrant));
    const rescheduleIssued = mock(() => Effect.succeed(pastGrant));

    const issued = await Effect.gen(function* () {
      const service = yield* ReservationAccessService;
      return yield* service.issueForReservation(pastReservation);
    }).pipe(
      Effect.provide(
        ReservationAccessService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ReservationAccessRepository, {
                findByReservationId: mock(() => Effect.succeed(pastGrant)),
                ensure,
                rescheduleIssued,
                loadIssuedCode: mock(() => Effect.succeed(accessCode)),
              }),
              Layer.mock(IgloohomeService, { issueHourlyAlgoPin })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(issued.accessCode).toBe(accessCode);
    expect(ensure).not.toHaveBeenCalled();
    expect(rescheduleIssued).not.toHaveBeenCalled();
    expect(issueHourlyAlgoPin).not.toHaveBeenCalled();
  });

  type RescheduleIssuedInput = Parameters<
    (typeof ReservationAccessRepository.Service)["rescheduleIssued"]
  >[0];
  const rescheduleIssuedToBounds = () =>
    mock((input: RescheduleIssuedInput) =>
      Effect.succeed({ ...grant, ...input.to })
    );

  test("records the moved span when reservation times retain the same rounded access target", async () => {
    const scheduledGrant = {
      ...grant,
      scheduledAccessStartsAt: Temporal.Instant.from("2099-07-01T08:15:00Z"),
      accessStartsAt: Temporal.Instant.from("2099-07-01T08:15:00Z"),
      accessEndsAt: Temporal.Instant.from("2099-07-01T16:15:00Z"),
    };
    const movedReservation = {
      reservationId,
      reservedFrom: Temporal.Instant.from("2099-07-01T08:45:00Z"),
      reservedUntil: Temporal.Instant.from("2099-07-01T16:45:00Z"),
    };
    const issueHourlyAlgoPin = mock(() =>
      Effect.die("Igloohome must not be called")
    );
    const ensure = mock(() => Effect.die("A reused PIN must not be reset"));
    const rescheduleIssued = rescheduleIssuedToBounds();
    const loadIssuedCode = mock((_: ScheduledBounds) =>
      Effect.succeed(accessCode)
    );
    const markUncertain = mock(() => Effect.void);

    const issued = await Effect.gen(function* () {
      const service = yield* ReservationAccessService;
      return yield* service.issueForReservation(movedReservation);
    }).pipe(
      Effect.provide(
        ReservationAccessService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ReservationAccessRepository, {
                findByReservationId: mock(() => Effect.succeed(scheduledGrant)),
                ensure,
                rescheduleIssued,
                loadIssuedCode,
                markUncertain,
              }),
              Layer.mock(IgloohomeService, { issueHourlyAlgoPin })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(issued.accessCode).toBe(accessCode);
    expect(issued.accessStartsAt.equals(movedReservation.reservedFrom)).toBe(
      true
    );
    expect(issued.accessEndsAt.equals(movedReservation.reservedUntil)).toBe(
      true
    );
    expect(rescheduleIssued).toHaveBeenCalledTimes(1);
    const [rescheduled] = rescheduleIssued.mock.calls[0] ?? [];
    expect(
      rescheduled?.from.scheduledAccessStartsAt.equals(
        scheduledGrant.scheduledAccessStartsAt
      )
    ).toBe(true);
    expect(
      rescheduled?.to.scheduledAccessStartsAt.equals(
        movedReservation.reservedFrom
      )
    ).toBe(true);
    expect(
      rescheduled?.to.accessStartsAt.equals(movedReservation.reservedFrom)
    ).toBe(true);
    expect(
      rescheduled?.to.accessEndsAt.equals(movedReservation.reservedUntil)
    ).toBe(true);
    expect(loadIssuedCode).toHaveBeenCalledTimes(1);
    expect(formatBounds(loadIssuedCode.mock.calls[0]?.[0])).toEqual({
      scheduledAccessStartsAt: movedReservation.reservedFrom.toString(),
      accessStartsAt: movedReservation.reservedFrom.toString(),
      accessEndsAt: movedReservation.reservedUntil.toString(),
    });
    expect(ensure).not.toHaveBeenCalled();
    expect(markUncertain).not.toHaveBeenCalled();
    expect(issueHourlyAlgoPin).not.toHaveBeenCalled();
  });

  test("shows an earlier early-setup start without reissuing the PIN", async () => {
    // Setup moved from 9:45 to 9:30 Prague time, within the same lock hour.
    const earlySetupGrant = {
      ...grant,
      scheduledAccessStartsAt: Temporal.Instant.from("2099-07-01T07:45:00Z"),
      accessStartsAt: Temporal.Instant.from("2099-07-01T07:45:00Z"),
      accessEndsAt: Temporal.Instant.from("2099-07-01T09:00:00Z"),
    };
    const earlierSetup = {
      reservationId,
      reservedFrom: Temporal.Instant.from("2099-07-01T07:30:00Z"),
      reservedUntil: Temporal.Instant.from("2099-07-01T09:00:00Z"),
    };
    const issueHourlyAlgoPin = mock(() =>
      Effect.die("Igloohome must not be called")
    );
    const rescheduleIssued = rescheduleIssuedToBounds();

    const issued = await Effect.gen(function* () {
      const service = yield* ReservationAccessService;
      return yield* service.issueForReservation(earlierSetup);
    }).pipe(
      Effect.provide(
        ReservationAccessService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ReservationAccessRepository, {
                findByReservationId: mock(() =>
                  Effect.succeed(earlySetupGrant)
                ),
                rescheduleIssued,
                loadIssuedCode: mock(() => Effect.succeed(accessCode)),
              }),
              Layer.mock(IgloohomeService, { issueHourlyAlgoPin })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(issued.accessCode).toBe(accessCode);
    expect(issued.accessStartsAt.equals(earlierSetup.reservedFrom)).toBe(true);
    expect(rescheduleIssued).toHaveBeenCalledTimes(1);
    expect(issueHourlyAlgoPin).not.toHaveBeenCalled();
  });

  test("takes the exact span when reusing legacy rounded bounds for an early-setup reservation", async () => {
    const earlySetupReservation = {
      reservationId,
      reservedFrom: Temporal.Instant.from("2099-07-01T07:45:00Z"),
      reservedUntil: Temporal.Instant.from("2099-07-01T09:00:00Z"),
    };
    const legacyGrant = {
      ...grant,
      scheduledAccessStartsAt: Temporal.Instant.from("2099-07-01T07:00:00Z"),
      accessStartsAt: Temporal.Instant.from("2099-07-01T07:00:00Z"),
      accessEndsAt: Temporal.Instant.from("2099-07-01T09:00:00Z"),
    };
    const rescheduleIssued = rescheduleIssuedToBounds();
    const loadIssuedCode = mock(() => Effect.succeed(accessCode));
    const issueHourlyAlgoPin = mock(() =>
      Effect.die("Igloohome must not be called")
    );

    const issued = await Effect.gen(function* () {
      const service = yield* ReservationAccessService;
      return yield* service.issueForReservation(earlySetupReservation);
    }).pipe(
      Effect.provide(
        ReservationAccessService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ReservationAccessRepository, {
                findByReservationId: mock(() => Effect.succeed(legacyGrant)),
                rescheduleIssued,
                loadIssuedCode,
              }),
              Layer.mock(IgloohomeService, { issueHourlyAlgoPin })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(issued.accessCode).toBe(accessCode);
    expect(
      issued.accessStartsAt.equals(earlySetupReservation.reservedFrom)
    ).toBe(true);
    expect(rescheduleIssued).toHaveBeenCalledTimes(1);
    expect(loadIssuedCode).toHaveBeenCalledTimes(1);
    expect(issueHourlyAlgoPin).not.toHaveBeenCalled();
  });

  test("withholds a reused PIN when its grant changed concurrently", async () => {
    const scheduledGrant = {
      ...grant,
      scheduledAccessStartsAt: Temporal.Instant.from("2099-07-01T08:15:00Z"),
      accessStartsAt: Temporal.Instant.from("2099-07-01T08:15:00Z"),
    };
    const loadIssuedCode = mock(() => Effect.succeed(accessCode));
    const issueHourlyAlgoPin = mock(() =>
      Effect.die("Igloohome must not be called")
    );

    const result = await Effect.gen(function* () {
      const service = yield* ReservationAccessService;
      return yield* service.issueForReservation(reservation);
    }).pipe(
      Effect.provide(
        ReservationAccessService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ReservationAccessRepository, {
                findByReservationId: mock(() => Effect.succeed(scheduledGrant)),
                rescheduleIssued: mock(() => Effect.succeed(null)),
                loadIssuedCode,
              }),
              Layer.mock(IgloohomeService, { issueHourlyAlgoPin })
            )
          )
        )
      ),
      Effect.result,
      Effect.runPromise
    );

    expect(Result.isFailure(result)).toBe(true);
    expect(loadIssuedCode).not.toHaveBeenCalled();
    expect(issueHourlyAlgoPin).not.toHaveBeenCalled();
  });

  const issueAfterConcurrentIssuance = (
    concurrentGrant: typeof grant,
    request = reservation
  ) => {
    const loadIssuedCode = mock(() => Effect.succeed(accessCode));
    const rescheduleIssued = rescheduleIssuedToBounds();
    const issueHourlyAlgoPin = mock(() =>
      Effect.die("Igloohome must not be called")
    );
    const result = Effect.gen(function* () {
      const service = yield* ReservationAccessService;
      return yield* service.issueForReservation(request);
    }).pipe(
      Effect.provide(
        ReservationAccessService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ReservationAccessRepository, {
                findByReservationId: mock(() => Effect.succeed(null)),
                ensure: mock(() => Effect.succeed(concurrentGrant)),
                rescheduleIssued,
                loadIssuedCode,
              }),
              Layer.mock(IgloohomeService, { issueHourlyAlgoPin })
            )
          )
        )
      ),
      Effect.result,
      Effect.runPromise
    );
    return { result, loadIssuedCode, rescheduleIssued, issueHourlyAlgoPin };
  };

  test("reuses a PIN a concurrent request issued for the same hours", async () => {
    const { result, rescheduleIssued, issueHourlyAlgoPin } =
      issueAfterConcurrentIssuance(grant);

    const issued = await result;
    expect(Result.isSuccess(issued)).toBe(true);
    expect(rescheduleIssued).not.toHaveBeenCalled();
    expect(issueHourlyAlgoPin).not.toHaveBeenCalled();
  });

  test("records the exact span on a whole-hour PIN an earlier release issued concurrently", async () => {
    const earlySetupReservation = {
      reservationId,
      reservedFrom: Temporal.Instant.from("2099-07-01T07:45:00Z"),
      reservedUntil: Temporal.Instant.from("2099-07-01T09:00:00Z"),
    };
    const { result, rescheduleIssued, issueHourlyAlgoPin } =
      issueAfterConcurrentIssuance(
        {
          ...grant,
          scheduledAccessStartsAt: Temporal.Instant.from(
            "2099-07-01T07:00:00Z"
          ),
          accessStartsAt: Temporal.Instant.from("2099-07-01T07:00:00Z"),
          accessEndsAt: Temporal.Instant.from("2099-07-01T09:00:00Z"),
        },
        earlySetupReservation
      );

    const issued = Result.getOrThrow(await result);
    expect(issued.accessCode).toBe(accessCode);
    expect(
      issued.accessStartsAt.equals(earlySetupReservation.reservedFrom)
    ).toBe(true);
    expect(
      issued.accessEndsAt.equals(earlySetupReservation.reservedUntil)
    ).toBe(true);
    expect(rescheduleIssued).toHaveBeenCalledTimes(1);
    expect(issueHourlyAlgoPin).not.toHaveBeenCalled();
  });

  test("withholds a PIN a concurrent request issued for other hours", async () => {
    const { result, loadIssuedCode, issueHourlyAlgoPin } =
      issueAfterConcurrentIssuance({
        ...grant,
        scheduledAccessStartsAt: reservation.reservedFrom.add({ hours: 4 }),
        accessStartsAt: reservation.reservedFrom.add({ hours: 4 }),
        accessEndsAt: reservation.reservedUntil.add({ hours: 4 }),
      });

    expect(Result.isFailure(await result)).toBe(true);
    expect(loadIssuedCode).not.toHaveBeenCalled();
    expect(issueHourlyAlgoPin).not.toHaveBeenCalled();
  });

  test("reuses an exact-span credential a concurrent request issued while this one prepared its grant", async () => {
    const exactGrant = {
      ...grant,
      scheduledAccessStartsAt: Temporal.Instant.from("2099-07-01T08:45:00Z"),
      accessStartsAt: Temporal.Instant.from("2099-07-01T08:45:00Z"),
      accessEndsAt: Temporal.Instant.from("2099-07-01T15:30:00Z"),
    };
    const loadIssuedCode = mock((_: ScheduledBounds) =>
      Effect.succeed(accessCode)
    );
    const claim = mock(() => Effect.die("an issued grant must not be claimed"));
    const issueHourlyAlgoPin = mock(() =>
      Effect.die("Igloohome must not be called")
    );

    const issued = await Effect.gen(function* () {
      const service = yield* ReservationAccessService;
      return yield* service.issueForReservation(reservation);
    }).pipe(
      Effect.provide(
        ReservationAccessService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ReservationAccessRepository, {
                findByReservationId: mock(() => Effect.succeed(null)),
                ensure: mock(() => Effect.succeed(exactGrant)),
                rescheduleIssued: rescheduleIssuedToBounds(),
                loadIssuedCode,
                claim,
              }),
              Layer.mock(IgloohomeService, { issueHourlyAlgoPin })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(issued).toEqual({
      grantId,
      accessCode,
      accessStartsAt: reservation.reservedFrom,
      accessEndsAt: reservation.reservedUntil,
    });
    expect(formatBounds(loadIssuedCode.mock.calls[0]?.[0])).toEqual({
      scheduledAccessStartsAt: reservation.reservedFrom.toString(),
      accessStartsAt: reservation.reservedFrom.toString(),
      accessEndsAt: reservation.reservedUntil.toString(),
    });
    expect(claim).not.toHaveBeenCalled();
    expect(issueHourlyAlgoPin).not.toHaveBeenCalled();
  });

  test("withholds a PIN a concurrent request issued for other hours while this one prepared its grant", async () => {
    const movedGrant = {
      ...grant,
      scheduledAccessStartsAt: Temporal.Instant.from("2099-07-02T08:00:00Z"),
      accessStartsAt: Temporal.Instant.from("2099-07-02T08:00:00Z"),
      accessEndsAt: Temporal.Instant.from("2099-07-02T16:00:00Z"),
    };
    const loadIssuedCode = mock(() => Effect.succeed(accessCode));
    const issueHourlyAlgoPin = mock(() =>
      Effect.die("Igloohome must not be called")
    );

    const result = await Effect.gen(function* () {
      const service = yield* ReservationAccessService;
      return yield* service
        .issueForReservation(reservation)
        .pipe(Effect.result);
    }).pipe(
      Effect.provide(
        ReservationAccessService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ReservationAccessRepository, {
                findByReservationId: mock(() => Effect.succeed(null)),
                ensure: mock(() => Effect.succeed(movedGrant)),
                loadIssuedCode,
              }),
              Layer.mock(IgloohomeService, { issueHourlyAlgoPin })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.outcome).toBe("rejected");
    }
    expect(loadIssuedCode).not.toHaveBeenCalled();
    expect(issueHourlyAlgoPin).not.toHaveBeenCalled();
  });

  test("reissues an issued credential when its rounded reservation schedule changes", async () => {
    const movedReservation = {
      ...reservation,
      reservedUntil: reservation.reservedUntil.add({ hours: 1 }),
    };
    // A grant issued before access names were stored keeps the name built
    // from its reservation until its next Igloohome request.
    const replacementGrant = {
      ...grant,
      state: "pending" as const,
      accessName: `Deskohub ${reservationId}`,
      accessEndsAt: movedReservation.reservedUntil,
    };
    const ensure = mock(() => Effect.succeed(replacementGrant));
    const claim = mock((_: ScheduledBounds) => Effect.succeed(true));
    const markIssued = mock(() => Effect.void);
    const markUncertain = mock(() => Effect.void);
    const issueHourlyAlgoPin = mock(() =>
      Effect.succeed({ pin: replacementAccessCode, pinId: replacementPinId })
    );

    const issued = await Effect.gen(function* () {
      const service = yield* ReservationAccessService;
      return yield* service.issueForReservation(movedReservation);
    }).pipe(
      Effect.provide(
        ReservationAccessService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ReservationAccessRepository, {
                findByReservationId: mock(() => Effect.succeed(grant)),
                ensure,
                claim,
                markIssued,
                markUncertain,
              }),
              Layer.mock(IgloohomeService, { issueHourlyAlgoPin })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(issued.accessCode).toBe(replacementAccessCode);
    expect(ensure).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId,
        accessEndsAt: movedReservation.reservedUntil,
        replacingIssued: grant,
      })
    );
    expect(issueHourlyAlgoPin).toHaveBeenCalledWith({
      deviceId,
      variance: 1,
      startsAt: "2099-07-01T10:00:00+02:00",
      endsAt: "2099-07-01T19:00:00+02:00",
      accessName: `Deskohub ${grantId}`,
    });
    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({ accessName: `Deskohub ${grantId}` })
    );
    // The claim is a compare-and-set on the bounds this request read and
    // sends to Igloohome.
    expect(formatBounds(claim.mock.calls[0]?.[0])).toEqual({
      scheduledAccessStartsAt: "2099-07-01T08:00:00Z",
      accessStartsAt: "2099-07-01T08:00:00Z",
      accessEndsAt: "2099-07-01T17:00:00Z",
    });
    expect(markIssued).toHaveBeenCalledWith(
      expect.objectContaining({
        accessCode: replacementAccessCode,
        pinId: replacementPinId,
      })
    );
    expect(markUncertain).not.toHaveBeenCalled();
  });

  test("reissues a legacy grant when early setup moves it to different rounded hours", async () => {
    const movedReservation = {
      reservationId,
      reservedFrom: Temporal.Instant.from("2099-07-01T08:45:00Z"),
      reservedUntil: Temporal.Instant.from("2099-07-01T10:00:00Z"),
    };
    const legacyGrant = {
      ...grant,
      scheduledAccessStartsAt: Temporal.Instant.from("2099-07-01T07:00:00Z"),
      accessStartsAt: Temporal.Instant.from("2099-07-01T07:00:00Z"),
      accessEndsAt: Temporal.Instant.from("2099-07-01T09:00:00Z"),
    };
    const replacementGrant = {
      ...legacyGrant,
      state: "pending" as const,
      scheduledAccessStartsAt: movedReservation.reservedFrom,
      accessStartsAt: movedReservation.reservedFrom,
      accessEndsAt: movedReservation.reservedUntil,
    };
    const ensure = mock(() => Effect.succeed(replacementGrant));
    const claim = mock(() => Effect.succeed(true));
    const markIssued = mock(() => Effect.void);
    const markUncertain = mock(() => Effect.void);
    const issueHourlyAlgoPin = mock(() =>
      Effect.succeed({ pin: replacementAccessCode, pinId: replacementPinId })
    );

    const issued = await Effect.gen(function* () {
      const service = yield* ReservationAccessService;
      return yield* service.issueForReservation(movedReservation);
    }).pipe(
      Effect.provide(
        ReservationAccessService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ReservationAccessRepository, {
                findByReservationId: mock(() => Effect.succeed(legacyGrant)),
                ensure,
                claim,
                markIssued,
                markUncertain,
              }),
              Layer.mock(IgloohomeService, { issueHourlyAlgoPin })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(issued.accessCode).toBe(replacementAccessCode);
    expect(ensure).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId,
        scheduledAccessStartsAt: movedReservation.reservedFrom,
        accessStartsAt: movedReservation.reservedFrom,
        accessEndsAt: movedReservation.reservedUntil,
      })
    );
    expect(issueHourlyAlgoPin).toHaveBeenCalledWith(
      expect.objectContaining({
        startsAt: "2099-07-01T10:00:00+02:00",
        endsAt: "2099-07-01T12:00:00+02:00",
      })
    );
    expect(claim).toHaveBeenCalledTimes(1);
    expect(markIssued).toHaveBeenCalledTimes(1);
    expect(markUncertain).not.toHaveBeenCalled();
  });

  test("withholds an issued credential when its device changed", async () => {
    const loadIssuedCode = mock(() => Effect.succeed(accessCode));
    const markUncertain = mock(() => Effect.void);
    const issueHourlyAlgoPin = mock(() =>
      Effect.die("Igloohome must not be called")
    );
    const result = await Effect.gen(function* () {
      const service = yield* ReservationAccessService;
      return yield* service
        .issueForReservation(reservation)
        .pipe(Effect.result);
    }).pipe(
      Effect.provide(
        ReservationAccessService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ReservationAccessRepository, {
                findByReservationId: mock(() =>
                  Effect.succeed({ ...grant, deviceId: otherDeviceId })
                ),
                ensure: mock(() => Effect.die("grant must not be replaced")),
                loadIssuedCode,
                markUncertain,
              }),
              Layer.mock(IgloohomeService, { issueHourlyAlgoPin })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.outcome).toBe("uncertain");
    }
    expect(loadIssuedCode).not.toHaveBeenCalled();
    expect(markUncertain).toHaveBeenCalledTimes(1);
    expect(issueHourlyAlgoPin).not.toHaveBeenCalled();
  });

  test("names a new credential by its grant, not its reservation", async () => {
    const claim = mock(() => Effect.succeed(true));
    const issueHourlyAlgoPin = mock(() =>
      Effect.succeed({ pin: accessCode, pinId })
    );

    await Effect.gen(function* () {
      const service = yield* ReservationAccessService;
      return yield* service.issueForReservation(reservation);
    }).pipe(
      Effect.provide(
        ReservationAccessService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ReservationAccessRepository, {
                findByReservationId: mock(() => Effect.succeed(null)),
                ensure: mock(() =>
                  Effect.succeed({
                    ...grant,
                    state: "pending" as const,
                    accessName: null,
                  })
                ),
                claim,
                markIssued: mock(() => Effect.void),
              }),
              Layer.mock(IgloohomeService, { issueHourlyAlgoPin })
            )
          )
        )
      ),
      Effect.runPromise
    );

    // The name is stored before the request, so an operator can find a
    // credential whose issuance outcome is unknown.
    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({
        id: grantId,
        accessName: `Deskohub ${grantId}`,
      })
    );
    expect(issueHourlyAlgoPin).toHaveBeenCalledWith(
      expect.objectContaining({ accessName: `Deskohub ${grantId}` })
    );
    expect(issueHourlyAlgoPin).not.toHaveBeenCalledWith(
      expect.objectContaining({
        accessName: expect.stringContaining(reservationId),
      })
    );
  });

  test("records an ambiguous provider result and never retries it", async () => {
    const markUncertain = mock(() => Effect.void);
    const markFailed = mock(() => Effect.void);
    const issueHourlyAlgoPin = mock(() =>
      Effect.fail(
        new IgloohomeRequestError({
          operation: "issue_hourly_algopin",
          outcome: "ambiguous",
          message: "unknown outcome",
        })
      )
    );
    const result = await Effect.gen(function* () {
      const service = yield* ReservationAccessService;
      return yield* service
        .issueForReservation(reservation)
        .pipe(Effect.result);
    }).pipe(
      Effect.provide(
        ReservationAccessService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ReservationAccessRepository, {
                findByReservationId: mock(() => Effect.succeed(null)),
                ensure: mock(() =>
                  Effect.succeed({ ...grant, state: "pending" })
                ),
                claim: mock(() => Effect.succeed(true)),
                markUncertain,
                markFailed,
              }),
              Layer.mock(IgloohomeService, { issueHourlyAlgoPin })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.outcome).toBe("uncertain");
    }
    expect(issueHourlyAlgoPin).toHaveBeenCalledTimes(1);
    expect(markUncertain).toHaveBeenCalledTimes(1);
    expect(markFailed).not.toHaveBeenCalled();
  });

  test("confirms manual provider removal only for an uncertain grant", async () => {
    const reconcileUncertain = mock(() =>
      Effect.succeed({ ...grant, state: "failed" as const })
    );
    const reconciledAt = Temporal.Instant.from("2099-07-01T07:00:00.0005Z");
    let clock = reconciledAt;
    const originalNow = Temporal.Now.instant;
    Temporal.Now.instant = () => {
      const readAt = clock;
      clock = clock.add({ nanoseconds: 600_000 });
      return readAt;
    };

    try {
      const reconciled = await Effect.gen(function* () {
        const service = yield* ReservationAccessService;
        return yield* service.confirmProviderCredentialRemoved(reservationId);
      }).pipe(
        Effect.provide(
          ReservationAccessService.Default.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.mock(ReservationAccessRepository, { reconcileUncertain }),
                Layer.mock(IgloohomeService, {})
              )
            )
          )
        ),
        Effect.runPromise
      );

      expect(reconciled.state).toBe("failed");
    } finally {
      Temporal.Now.instant = originalNow;
    }

    const input = reconcileUncertain.mock.calls[0]?.[0];
    expect(input?.reservationId).toBe(reservationId);
    expect(
      input &&
        input.reconciledAt.epochMilliseconds -
          input.provisioningStaleBefore.epochMilliseconds
    ).toBe(60_000);
    expect(input?.reconciledAt.equals(reconciledAt)).toBe(true);
    expect(
      input?.provisioningStaleBefore.equals(
        reconciledAt.subtract({ milliseconds: 60_000 })
      )
    ).toBe(true);
  });
});
