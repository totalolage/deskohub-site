import { expect, test } from "bun:test";
import { Deferred, Effect, Fiber } from "effect";
import {
  makeSuiteLocalProviderVerificationPermitLayer,
  WorkspaceE2EProviderVerificationPermitService,
} from "./provider-verification-permit.service";

test("holds provider verification capacity through the cooldown", async () => {
  const cooldownMs = 30;
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
