import "@/shared/testing/workspace-test-env";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Context, Effect, Layer } from "effect";

const cronSecret = "workspace-cron-secret";

type FakeReservationHoldCleanupService = {
  readonly cancelOrderHold: () => Effect.Effect<void>;
  readonly sweepExpiredHolds: (input: {
    readonly now: Date;
    readonly limit: number;
  }) => Effect.Effect<{ readonly cancelled: number; readonly failed: number }>;
};

type FakeWorkspaceAvailabilityInventoryService = {
  readonly invalidateAdvisory: () => Effect.Effect<void, string>;
};

const FakeReservationHoldCleanupService =
  Context.Service<FakeReservationHoldCleanupService>(
    "ReservationHoldCleanupService"
  );
const FakeWorkspaceAvailabilityInventoryService =
  Context.Service<FakeWorkspaceAvailabilityInventoryService>(
    "WorkspaceAvailabilityInventoryService"
  );

const sweepExpiredHolds = mock(() =>
  Effect.succeed({ cancelled: 1, failed: 0 })
);
const invalidateAdvisory = mock(() => Effect.fail("cache failed"));

mock.module("@/env", () => ({
  env: {
    ...process.env,
    CRON_SECRET: cronSecret,
    VERCEL_ENV: "production",
  },
}));

mock.module(
  "@/features/checkout/backend/reservation-hold-cleanup.service",
  () => ({
    ReservationHoldCleanupService: FakeReservationHoldCleanupService,
    ReservationHoldCleanupServiceLiveWithDependencies: Layer.succeed(
      FakeReservationHoldCleanupService,
      {
        cancelOrderHold: mock(() => Effect.void),
        sweepExpiredHolds,
      }
    ),
  })
);

mock.module(
  "@/features/reservation/backend/workspace-availability.service",
  () => ({
    WorkspaceAvailabilityInventoryService:
      FakeWorkspaceAvailabilityInventoryService,
    WorkspaceAvailabilityInventoryServiceLiveWithDependencies: Layer.succeed(
      FakeWorkspaceAvailabilityInventoryService,
      { invalidateAdvisory }
    ),
  })
);

mock.module("@/shared/backend/logging/censorship", () => ({
  runWorkspaceRequestEffect: (
    _request: Request,
    effect: Effect.Effect<unknown>
  ) => Effect.runPromise(effect),
}));

const cronRequest = () =>
  new Request(
    "https://workspace.example.test/api/cron/workspace/reservation-holds",
    { headers: { authorization: `Bearer ${cronSecret}` } }
  );

describe("reservation hold cleanup cron route", () => {
  beforeEach(() => {
    sweepExpiredHolds.mockClear();
    sweepExpiredHolds.mockImplementation(() =>
      Effect.succeed({ cancelled: 1, failed: 0 })
    );
    invalidateAdvisory.mockClear();
    invalidateAdvisory.mockImplementation(() => Effect.fail("cache failed"));
  });

  test("returns the sweep result when advisory invalidation fails", async () => {
    const { GET } = await import("./route");

    const response = await GET(cronRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cancelled: 1, failed: 0 });
    expect(invalidateAdvisory).toHaveBeenCalledTimes(1);
  });
});
