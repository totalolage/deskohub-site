import { describe, expect, test } from "bun:test";
import { Context, Deferred, Effect, Exit, Layer, Logger } from "effect";
import { NextEffect } from "..";
import { shareAcrossRequests } from "./shared-layer";

class Provider extends Context.Service<Provider, { readonly build: number }>()(
  "@deskohub/next-effect/test/Provider"
) {}

class Directory extends Context.Service<
  Directory,
  { readonly build: number }
>()("@deskohub/next-effect/test/Directory") {}

class Connection extends Context.Service<
  Connection,
  { readonly build: number }
>()("@deskohub/next-effect/test/Connection") {}

const counted = <I, S>(tag: Context.Key<I, S>, make: (build: number) => S) => {
  let builds = 0;
  return {
    builds: () => builds,
    layer: Layer.sync(tag, () => {
      builds += 1;
      return make(builds);
    }),
  };
};

/** Fails its first `failures` builds with `error`, then succeeds. */
const failingFirst = <I, S>(
  tag: Context.Key<I, S>,
  failures: number,
  error: Error,
  make: (build: number) => S
) => {
  let builds = 0;
  return {
    builds: () => builds,
    layer: Layer.effect(
      tag,
      Effect.suspend(() => {
        builds += 1;
        return builds <= failures
          ? Effect.fail(error)
          : Effect.succeed(make(builds));
      })
    ),
  };
};

const provideTo =
  <A, E>(layer: Layer.Layer<A, E>) =>
  <B, F>(effect: Effect.Effect<B, F, A>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer)));

describe("shareAcrossRequests", () => {
  test("builds once and gives every later run the same instance", async () => {
    const provider = counted(Provider, (build) => ({ build }));
    const shared = shareAcrossRequests(provider.layer);
    const runtime = NextEffect.make();

    const first = await provideTo(shared)(Effect.service(Provider));
    const second = await provideTo(shared)(Effect.service(Provider));
    const throughRuntime = await runtime.run(
      Effect.service(Provider).pipe(Effect.provide(shared))
    );

    expect(provider.builds()).toBe(1);
    expect(second).toBe(first);
    expect(throughRuntime).toBe(first);
  });

  test("concurrent first runs wait for one build", async () => {
    const built = Deferred.makeUnsafe<void>();
    let builds = 0;
    const shared = shareAcrossRequests(
      Layer.effect(
        Provider,
        Effect.suspend(() => {
          builds += 1;
          return Effect.as(Deferred.await(built), { build: builds });
        })
      )
    );

    const runs = Promise.all([
      provideTo(shared)(Effect.service(Provider)),
      provideTo(shared)(Effect.service(Provider)),
    ]);
    await Bun.sleep(0);
    Effect.runSync(Deferred.succeed(built, undefined));
    const [first, second] = await runs;

    expect(builds).toBe(1);
    expect(second).toBe(first);
  });

  test("drops a failed build, so later runs build again until one succeeds", async () => {
    const error = new Error("provider unavailable");
    const provider = failingFirst(Provider, 2, error, (build) => ({ build }));
    const shared = shareAcrossRequests(provider.layer);
    const resolve = () => provideTo(shared)(Effect.service(Provider));

    await expect(resolve()).rejects.toBe(error);
    await expect(resolve()).rejects.toBe(error);
    const recovered = await resolve();
    const later = await resolve();

    expect(recovered).toEqual({ build: 3 });
    expect(later).toBe(recovered);
    expect(provider.builds()).toBe(3);
  });

  test("fails every run waiting for a build that fails", async () => {
    const error = new Error("provider unavailable");
    const attempted = Deferred.makeUnsafe<void>();
    let builds = 0;
    const shared = shareAcrossRequests(
      Layer.effect(
        Provider,
        Effect.suspend(() => {
          builds += 1;
          return Deferred.await(attempted).pipe(
            Effect.andThen(Effect.fail(error))
          );
        })
      )
    );

    const runs = Promise.allSettled([
      provideTo(shared)(Effect.service(Provider)),
      provideTo(shared)(Effect.service(Provider)),
    ]);
    await Bun.sleep(0);
    Effect.runSync(Deferred.succeed(attempted, undefined));

    expect(await runs).toEqual([
      { status: "rejected", reason: error },
      { status: "rejected", reason: error },
    ]);
    expect(builds).toBe(1);
  });

  test("drops a build its run interrupted, so the next run builds it", async () => {
    const started = Deferred.makeUnsafe<void>();
    let builds = 0;
    const shared = shareAcrossRequests(
      Layer.effect(
        Provider,
        Effect.suspend(() => {
          builds += 1;
          return builds === 1
            ? Deferred.succeed(started, undefined).pipe(
                Effect.andThen(Effect.never)
              )
            : Effect.succeed({ build: builds });
        })
      )
    );
    const runtime = NextEffect.make();
    const controller = new AbortController();

    const interrupted = runtime.runExit(
      Effect.service(Provider).pipe(Effect.provide(shared)),
      { signal: controller.signal }
    );
    await Effect.runPromise(Deferred.await(started));
    controller.abort();

    expect(Exit.hasInterrupts(await interrupted)).toBe(true);
    await expect(provideTo(shared)(Effect.service(Provider))).resolves.toEqual({
      build: 2,
    });
  });

  test("builds independent shared layers separately, so one failing leaves the other working", async () => {
    const error = new Error("provider unavailable");
    const provider = failingFirst(Provider, Infinity, error, (build) => ({
      build,
    }));
    const directory = counted(Directory, (build) => ({ build }));
    const sharedProvider = shareAcrossRequests(provider.layer);
    const sharedDirectory = shareAcrossRequests(directory.layer);

    for (let run = 0; run < 2; run += 1) {
      await expect(
        provideTo(sharedProvider)(Effect.service(Provider))
      ).rejects.toBe(error);
      await expect(
        provideTo(sharedDirectory)(Effect.service(Directory))
      ).resolves.toEqual({ build: 1 });
    }
    expect(provider.builds()).toBe(2);
    expect(directory.builds()).toBe(1);
  });

  test("a run's own layers beside a shared one build per run, concurrent runs included", async () => {
    const provider = counted(Provider, (build) => ({ build }));
    const connection = counted(Connection, (build) => ({ build }));
    const shared = shareAcrossRequests(provider.layer);
    const runtime = NextEffect.make({ layer: shared });
    const release = Deferred.makeUnsafe<void>();
    const handler = Effect.gen(function* () {
      const { build: providerBuild } = yield* Provider;
      const { build: connectionBuild } = yield* Connection;
      yield* Deferred.await(release);
      return [providerBuild, connectionBuild] as const;
    }).pipe(Effect.provide(Layer.merge(shared, connection.layer)));

    const runs = Promise.all([runtime.run(handler), runtime.run(handler)]);
    await Bun.sleep(0);
    Effect.runSync(Deferred.succeed(release, undefined));
    const results = await runs;

    expect(provider.builds()).toBe(1);
    expect(connection.builds()).toBe(2);
    expect(results.map(([providerBuild]) => providerBuild)).toEqual([1, 1]);
    expect(
      results.map(([, connectionBuild]) => connectionBuild).sort()
    ).toEqual([1, 2]);
  });

  test("keeps the layers it is built from to itself", async () => {
    const connection = counted(Connection, (build) => ({ build }));
    const shared = shareAcrossRequests(
      Layer.effect(
        Provider,
        Effect.map(Effect.service(Connection), ({ build }) => ({ build }))
      ).pipe(Layer.provide(connection.layer))
    );
    const runtime = NextEffect.make({ layer: shared });

    const fromShared = await runtime.run(Effect.service(Provider));
    const own = await runtime.run(
      Effect.service(Connection).pipe(Effect.provide(connection.layer))
    );
    const ownAgain = await runtime.run(
      Effect.service(Connection).pipe(Effect.provide(connection.layer))
    );

    expect(fromShared).toEqual({ build: 1 });
    expect([own.build, ownAgain.build]).toEqual([2, 3]);
  });

  test("shares a shared layer it is built from with the runs that use it directly", async () => {
    const provider = counted(Provider, (build) => ({ build }));
    const sharedProvider = shareAcrossRequests(provider.layer);
    const sharedDirectory = shareAcrossRequests(
      Layer.effect(
        Directory,
        Effect.map(Effect.service(Provider), ({ build }) => ({ build }))
      ).pipe(Layer.provide(sharedProvider))
    );

    await provideTo(sharedDirectory)(Effect.service(Directory));
    const direct = await provideTo(sharedProvider)(Effect.service(Provider));

    expect(provider.builds()).toBe(1);
    expect(direct).toEqual({ build: 1 });
  });

  test("builds in the first run's fiber, so its logs go to that run's logger", async () => {
    const messages: unknown[] = [];
    const logger = Logger.make(({ message }) => {
      messages.push(message);
    });
    const shared = shareAcrossRequests(
      Layer.effect(
        Provider,
        Effect.as(Effect.logInfo("building provider"), { build: 1 })
      )
    );

    const run = Effect.service(Provider).pipe(Effect.provide(shared));
    await Effect.runPromise(Effect.provide(run, Logger.layer([logger])));

    expect(messages.flat()).toContain("building provider");
  });
});
