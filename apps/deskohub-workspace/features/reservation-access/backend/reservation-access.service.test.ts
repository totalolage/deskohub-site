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

describe("ReservationAccessService", () => {
  const reservation = {
    reservationId,
    reservedFrom: Temporal.Instant.from("2099-07-01T08:00:00Z"),
    reservedUntil: Temporal.Instant.from("2099-07-01T16:00:00Z"),
  };

  const grant = {
    id: grantId,
    workspaceReservationId: reservationId,
    deviceId,
    state: "issued" as const,
    providerCredentialId: pinId,
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

    const issued = await Effect.gen(function* () {
      const service = yield* ReservationAccessService;
      return yield* service.issueForReservation(pastReservation);
    }).pipe(
      Effect.provide(
        ReservationAccessService.Live.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ReservationAccessRepository, {
                findByReservationId: mock(() => Effect.succeed(pastGrant)),
                ensure,
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
    expect(issueHourlyAlgoPin).not.toHaveBeenCalled();
  });

  test("reuses an issued credential when reservation times retain the same rounded access target", async () => {
    const scheduledReservation = {
      reservationId,
      reservedFrom: Temporal.Instant.from("2099-07-01T08:15:00Z"),
      reservedUntil: Temporal.Instant.from("2099-07-01T16:15:00Z"),
    };
    const scheduledGrant = {
      ...grant,
      scheduledAccessStartsAt: Temporal.Instant.from("2099-07-01T08:00:00Z"),
      accessStartsAt: Temporal.Instant.from("2099-07-01T08:00:00Z"),
      accessEndsAt: Temporal.Instant.from("2099-07-01T17:00:00Z"),
    };
    const issueHourlyAlgoPin = mock(() =>
      Effect.die("Igloohome must not be called")
    );
    const loadIssuedCode = mock(() => Effect.succeed(accessCode));
    const markUncertain = mock(() => Effect.void);

    const issued = await Effect.gen(function* () {
      const service = yield* ReservationAccessService;
      return yield* service.issueForReservation({
        ...scheduledReservation,
        reservedFrom: Temporal.Instant.from("2099-07-01T08:45:00Z"),
        reservedUntil: Temporal.Instant.from("2099-07-01T16:45:00Z"),
      });
    }).pipe(
      Effect.provide(
        ReservationAccessService.Live.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ReservationAccessRepository, {
                findByReservationId: mock(() => Effect.succeed(scheduledGrant)),
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
    expect(loadIssuedCode).toHaveBeenCalledTimes(1);
    expect(markUncertain).not.toHaveBeenCalled();
    expect(issueHourlyAlgoPin).not.toHaveBeenCalled();
  });

  test("reissues an issued credential when its rounded reservation schedule changes", async () => {
    const movedReservation = {
      ...reservation,
      reservedUntil: reservation.reservedUntil.add({ hours: 1 }),
    };
    const replacementGrant = {
      ...grant,
      state: "pending" as const,
      accessEndsAt: movedReservation.reservedUntil,
    };
    const ensure = mock(() => Effect.succeed(replacementGrant));
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
        ReservationAccessService.Live.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ReservationAccessRepository, {
                findByReservationId: mock(() => Effect.succeed(grant)),
                ensure,
                claim: mock(() => Effect.succeed(true)),
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
      })
    );
    expect(issueHourlyAlgoPin).toHaveBeenCalledWith({
      deviceId,
      startsAt: "2099-07-01T10:00:00+02:00",
      endsAt: "2099-07-01T19:00:00+02:00",
      accessName: `Deskohub ${reservationId}`,
    });
    expect(markIssued).toHaveBeenCalledWith(
      expect.objectContaining({
        accessCode: replacementAccessCode,
        pinId: replacementPinId,
      })
    );
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
        ReservationAccessService.Live.pipe(
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
        ReservationAccessService.Live.pipe(
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

    const reconciled = await Effect.gen(function* () {
      const service = yield* ReservationAccessService;
      return yield* service.confirmProviderCredentialRemoved(reservationId);
    }).pipe(
      Effect.provide(
        ReservationAccessService.Live.pipe(
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
    const input = reconcileUncertain.mock.calls[0]?.[0];
    expect(input?.reservationId).toBe(reservationId);
    expect(
      input &&
        input.reconciledAt.epochMilliseconds -
          input.provisioningStaleBefore.epochMilliseconds
    ).toBe(60_000);
  });
});
