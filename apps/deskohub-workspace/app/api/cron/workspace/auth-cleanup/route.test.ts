import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { env } from "@/env";

const cleanupCalls: { readonly now: Date }[] = [];

interface IFakeCleanup {
  readonly deleteExpiredRows: (input: { readonly now: Date }) => Effect.Effect<
    {
      sessions: number;
      verifications: number;
      rateLimitRows: number;
      orphanedAccounts: number;
    },
    Error
  >;
}

const FakeCleanupService = Context.Service<FakeCleanupService, IFakeCleanup>()(
  "@test/FakeAuthCleanupService"
);

const fakeCleanupLayer = Layer.succeed(FakeCleanupService, {
  deleteExpiredRows: (input) => {
    cleanupCalls.push(input);
    return Effect.succeed({
      sessions: 3,
      verifications: 2,
      rateLimitRows: 1,
      orphanedAccounts: 0,
    });
  },
}) as Layer.Layer<FakeCleanupService>;

Object.assign(FakeCleanupService, { Live: fakeCleanupLayer });

mock.module("@/features/account/backend/auth/auth-cleanup.service", () => ({
  AuthCleanupService: FakeCleanupService,
}));

describe("auth cleanup cron route", () => {
  beforeEach(() => {
    cleanupCalls.length = 0;
  });

  test("sweeps rows expired at the run's time and returns the counts", async () => {
    const { GET } = (await import("./route")) as {
      GET: (request: Request) => Promise<Response>;
    };
    const before = Date.now();
    const response = await GET(
      new Request("https://workspace.test/api/cron/workspace/auth-cleanup", {
        headers: { authorization: `Bearer ${env.CRON_SECRET}` },
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sessions: 3,
      verifications: 2,
      rateLimitRows: 1,
      orphanedAccounts: 0,
    });
    expect(cleanupCalls).toHaveLength(1);
    expect(cleanupCalls[0]?.now.getTime()).toBeGreaterThanOrEqual(before);
  });
});
