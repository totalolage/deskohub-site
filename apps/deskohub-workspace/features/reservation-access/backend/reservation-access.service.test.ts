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
import {
  type IReservationAccessRepository,
  ReservationAccessRepository,
} from "./reservation-access.repository";
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

    expect(Result.isSuccess(accepted)).toBe(true);
    expect(Result.isFailure(rejected)).toBe(true);
  });

  test("rejects an ended reservation and non-hour boundaries", () => {
    for (const input of [
      {
        reservedFrom: Temporal.Instant.from("2026-07-01T08:00:00Z"),
        reservedUntil: Temporal.Instant.from("2026-07-01T09:00:00Z"),
        now: Temporal.Instant.from("2026-07-01T10:37:00Z"),
      },
      {
        reservedFrom: Temporal.Instant.from("2026-07-01T08:30:00Z"),
        reservedUntil: Temporal.Instant.from("2026-07-01T10:30:00Z"),
        now: Temporal.Instant.from("2026-07-01T07:00:00Z"),
      },
    ]) {
      const result = Effect.runSync(
        getReservationAccessInterval({ reservationId, ...input }).pipe(
          Effect.result
        )
      );
      expect(Result.isFailure(result)).toBe(true);
    }
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
    reservationStartsAt: reservation.reservedFrom,
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
      reservationStartsAt: pastReservation.reservedFrom,
      accessStartsAt: pastReservation.reservedFrom,
      accessEndsAt: pastReservation.reservedUntil,
    };
    const issueHourlyAlgoPin = mock(() =>
      Effect.die("Igloohome must not be called")
    );
    const repository = {
      findByReservationId: mock(() => Effect.succeed(pastGrant)),
      ensure: mock(() => Effect.succeed(pastGrant)),
      loadIssuedCode: mock(() => Effect.succeed(accessCode)),
    } as unknown as IReservationAccessRepository;

    const issued = await Effect.gen(function* () {
      const service = yield* ReservationAccessService;
      return yield* service.issueForReservation(pastReservation);
    }).pipe(
      Effect.provide(
        ReservationAccessService.Live.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(ReservationAccessRepository, repository),
              Layer.succeed(IgloohomeService, { issueHourlyAlgoPin })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(issued.accessCode).toBe(accessCode);
    expect(repository.ensure).not.toHaveBeenCalled();
    expect(issueHourlyAlgoPin).not.toHaveBeenCalled();
  });

  test("withholds an issued credential when its reservation or device changed", async () => {
    for (const [existingGrant, reservationInput] of [
      [
        grant,
        {
          ...reservation,
          reservedUntil: reservation.reservedUntil.add({ hours: 1 }),
        },
      ],
      [{ ...grant, deviceId: otherDeviceId }, reservation],
    ] as const) {
      const loadIssuedCode = mock(() => Effect.succeed(accessCode));
      const markUncertain = mock(() => Effect.void);
      const issueHourlyAlgoPin = mock(() =>
        Effect.die("Igloohome must not be called")
      );
      const repository = {
        findByReservationId: mock(() => Effect.succeed(existingGrant)),
        ensure: mock(() => Effect.die("grant must not be replaced")),
        loadIssuedCode,
        markUncertain,
      } as unknown as IReservationAccessRepository;

      const result = await Effect.gen(function* () {
        const service = yield* ReservationAccessService;
        return yield* service
          .issueForReservation(reservationInput)
          .pipe(Effect.result);
      }).pipe(
        Effect.provide(
          ReservationAccessService.Live.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(ReservationAccessRepository, repository),
                Layer.succeed(IgloohomeService, { issueHourlyAlgoPin })
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
    }
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
    const repository = {
      findByReservationId: mock(() => Effect.succeed(null)),
      ensure: mock(() => Effect.succeed({ ...grant, state: "pending" })),
      claim: mock(() => Effect.succeed(true)),
      markUncertain,
      markFailed,
    } as unknown as IReservationAccessRepository;

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
              Layer.succeed(ReservationAccessRepository, repository),
              Layer.succeed(IgloohomeService, { issueHourlyAlgoPin })
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
});
