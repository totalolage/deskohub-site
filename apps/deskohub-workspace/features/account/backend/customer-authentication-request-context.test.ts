import { expect, mock, test } from "bun:test";
import { Effect, Logger } from "effect";
import { withWorkspaceRequestContext } from "@/shared/backend/workspace-request-context";

const ambientHeaders = mock(() => {
  throw new Error("Request context is no longer available");
});
mock.module("next/headers", () => ({ headers: ambientHeaders }));
mock.module("@/env", () => ({
  env: {
    BETTER_AUTH_SECRETS: "1:test-only-strong-secret-value-9f2c7a41b8e6d530417c",
  },
}));
const observed: string[] = [];
mock.module("@/features/account/server/auth.server", () => ({
  auth: {
    api: {
      getSession: async ({
        headers,
        query,
      }: {
        headers: Headers;
        query: { disableRefresh: boolean };
      }) => {
        expect(query.disableRefresh).toBe(true);
        observed.push(headers.get("x-test-request") ?? "missing");
        return null;
      },
    },
  },
}));

test("authority reads use each request's captured headers after async work", async () => {
  const { CustomerAuthentication } = await import(
    "./customer-authentication.service"
  );
  const read = Effect.gen(function* () {
    const authentication = yield* CustomerAuthentication;
    yield* Effect.sleep("1 millis");
    yield* authentication.currentUser;
    yield* authentication.currentUser;
  }).pipe(Effect.provide(CustomerAuthentication.Default));
  await Effect.runPromise(
    Effect.all(
      [
        read.pipe(
          withWorkspaceRequestContext(
            new Headers({ "x-test-request": "first" })
          )
        ),
        read.pipe(
          withWorkspaceRequestContext(
            new Headers({ "x-test-request": "second" })
          )
        ),
      ],
      { concurrency: "unbounded" }
    )
  );
  expect(ambientHeaders).not.toHaveBeenCalled();
  expect(observed.sort()).toEqual(["first", "first", "second", "second"]);
});

test("an RSC read without captured headers fails closed when the request store is gone", async () => {
  const { CustomerAuthentication } = await import(
    "./customer-authentication.service"
  );
  const warnings: unknown[] = [];
  const outcome = await Effect.runPromise(
    Effect.flatMap(
      CustomerAuthentication,
      (authentication) => authentication.currentUser
    ).pipe(
      Effect.provide(CustomerAuthentication.Default),
      Effect.provide(
        Logger.layer([
          Logger.make((options) => {
            warnings.push(options.message);
          }),
        ])
      ),
      Effect.result
    )
  );

  expect(ambientHeaders).toHaveBeenCalledTimes(1);
  expect(outcome._tag).toBe("Failure");
  if (outcome._tag === "Failure") {
    expect(outcome.failure).toMatchObject({
      reason: "unavailable",
      diagnostic: "authentication.session.unclassified",
    });
  }
  expect(warnings).toEqual([
    [
      "Customer session read failed closed.",
      {
        diagnostic: "authentication.session.unclassified",
        stage: "request-headers",
        category: "Error",
      },
    ],
  ]);
});
