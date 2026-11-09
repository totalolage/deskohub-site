import { expect, test } from "bun:test";
import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import {
  makeSuiteLocalProviderVerificationPermitLayer,
  WorkspaceE2EProviderVerificationPermitService,
} from "./provider-verification-permit.service";

const cooldownMs = 30;

test("holds provider verification capacity through the cooldown", async () => {
  let firstCompletedAt = 0;
  let secondStartedAt = 0;

  await Effect.runPromise(
    Effect.gen(function* () {
      const permit = yield* WorkspaceE2EProviderVerificationPermitService;
      const firstStarted = yield* Deferred.make<void>();
      const releaseFirst = yield* Deferred.make<void>();
      const first = yield* Effect.forkChild(
        permit.withPermit(
          Deferred.succeed(firstStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseFirst)),
            Effect.andThen(
              Effect.sync(() => {
                firstCompletedAt = performance.now();
              })
            )
          )
        )
      );

      yield* Deferred.await(firstStarted);
      const second = yield* Effect.forkChild(
        permit.withPermit(
          Effect.sync(() => {
            secondStartedAt = performance.now();
          })
        )
      );
      yield* Deferred.succeed(releaseFirst, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);
    }).pipe(
      Effect.provide(makeSuiteLocalProviderVerificationPermitLayer(cooldownMs))
    )
  );

  expect(secondStartedAt - firstCompletedAt).toBeGreaterThanOrEqual(
    cooldownMs - 5
  );
});

test("holds provider verification capacity through the cooldown after failure", async () => {
  let firstFailedAt = 0;
  let secondStartedAt = 0;

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const permit = yield* WorkspaceE2EProviderVerificationPermitService;
      const firstStarted = yield* Deferred.make<void>();
      const first = yield* Effect.forkChild(
        permit.withPermit(
          Deferred.succeed(firstStarted, undefined).pipe(
            Effect.andThen(
              Effect.sync(() => {
                firstFailedAt = performance.now();
              })
            ),
            Effect.andThen(
              Effect.fail(new Error("provider verification failed"))
            )
          )
        )
      );

      yield* Deferred.await(firstStarted);
      const second = yield* Effect.forkChild(
        permit.withPermit(
          Effect.sync(() => {
            secondStartedAt = performance.now();
          })
        )
      );
      yield* Fiber.join(second);

      return {
        firstExit: yield* Fiber.await(first),
      };
    }).pipe(
      Effect.provide(makeSuiteLocalProviderVerificationPermitLayer(cooldownMs))
    )
  );

  expect(secondStartedAt - firstFailedAt).toBeGreaterThanOrEqual(
    cooldownMs - 5
  );
  expect(Exit.isFailure(result.firstExit)).toBe(true);
  if (Exit.isFailure(result.firstExit)) {
    expect(String(Cause.squash(result.firstExit.cause))).toContain(
      "provider verification failed"
    );
  }
});
