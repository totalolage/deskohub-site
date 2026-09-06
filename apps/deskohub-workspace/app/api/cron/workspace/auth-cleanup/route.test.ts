import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Context, Effect, Layer } from "effect";

process.env.CRON_SECRET = "cron-secret-for-auth-cleanup-test";

const cleanupCalls: { readonly now: Date }[] = [];

interface IFakeCleanup {
  readonly deleteExpiredRows: (input: {
    readonly now: Date;
  }) => Effect.Effect<
    { sessions: number; verifications: number; rateLimitRows: number },
    never
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
    });
  },
}) as Layer.Layer<FakeCleanupService>;

Object.assign(FakeCleanupService, { Live: fakeCleanupLayer });

mock.module("@/features/account/backend/auth/auth-cleanup.service", () => ({
  AuthCleanupFailure: class AuthCleanupFailure extends Error {
    readonly code: string;
    constructor(input: { readonly code: string }) {
      super(input.code);
      this.code = input.code;
    }
  },
  AuthCleanupService: FakeCleanupService,
}));

describe("auth cleanup cron route", () => {
  beforeEach(() => {
    cleanupCalls.length = 0;
  });

  test("rejects requests without the cron secret", async () => {
    const { GET } = (await import("./route")) as {
      GET: (request: Request) => Promise<Response>;
    };
    const response = await GET(
      new Request("https://workspace.test/api/cron/workspace/auth-cleanup")
    );

    expect(response.status).toBe(401);
    expect(cleanupCalls).toHaveLength(0);
  });

  test("rejects a wrong bearer secret", async () => {
    const { GET } = (await import("./route")) as {
      GET: (request: Request) => Promise<Response>;
    };
    const response = await GET(
      new Request("https://workspace.test/api/cron/workspace/auth-cleanup", {
        headers: { authorization: "Bearer not-the-secret" },
      })
    );

    expect(response.status).toBe(401);
    expect(cleanupCalls).toHaveLength(0);
  });

  test("sweeps expired authentication rows with the correct secret", async () => {
    const { GET } = (await import("./route")) as {
      GET: (request: Request) => Promise<Response>;
    };
    const response = await GET(
      new Request("https://workspace.test/api/cron/workspace/auth-cleanup", {
        headers: { authorization: "Bearer cron-secret-for-auth-cleanup-test" },
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sessions: 3,
      verifications: 2,
      rateLimitRows: 1,
    });
    expect(cleanupCalls).toHaveLength(1);
    expect(cleanupCalls[0]!.now).toBeInstanceOf(Date);
  });
});
