import { describe, expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Layer,
  Semaphore,
} from "effect";
import { notFound, redirect } from "next/navigation";
import { NextEffect } from ".";

class TestService extends Context.Service<
  TestService,
  { readonly value: string }
>()("@deskohub/next-effect/test/RunnerService") {}

describe("NextEffect", () => {
  test("run maps fallible layer setup failures", async () => {
    const mapped = new Error("mapped");
    const next = NextEffect.make({
      layer: Layer.effect(TestService, Effect.fail("setup")),
      mapError: () => mapped,
    });

    await expect(next.run(TestService)).rejects.toBe(mapped);
  });

  test("run builds the layer once and shares it across runs", async () => {
    let builds = 0;
    const next = NextEffect.make({
      layer: Layer.sync(TestService, () => {
        builds += 1;
        return { value: `build-${builds}` };
      }),
    });

    const readValue = Effect.map(TestService, ({ value }) => value);
    const concurrent = await Promise.all([
      next.run(readValue),
      next.run(readValue),
    ]);
    const later = await next.run(readValue);

    expect(builds).toBe(1);
    expect([...concurrent, later]).toEqual(["build-1", "build-1", "build-1"]);
  });

  test("runtimes sharing a memo map reuse each other's built layers", async () => {
    let builds = 0;
    const layer = Layer.sync(TestService, () => {
      builds += 1;
      return { value: "shared" };
    });
    const memoMap = Layer.makeMemoMapUnsafe();
    const first = NextEffect.make({ layer, memoMap });
    const second = NextEffect.make({ layer, memoMap });

    await first.run(TestService);
    await second.run(TestService);

    expect(builds).toBe(1);
  });

  test("concurrent runs do not share layers their effects provide", async () => {
    class RequestService extends Context.Service<
      RequestService,
      { readonly build: number }
    >()("@deskohub/next-effect/test/RequestService") {}
    let builds = 0;
    const requestLayer = Layer.sync(RequestService, () => {
      builds += 1;
      return { build: builds };
    });
    const next = NextEffect.make({
      layer: Layer.succeed(TestService, { value: "service" }),
    });
    const release = Deferred.makeUnsafe<void>();
    const handler = Effect.gen(function* () {
      const request = yield* RequestService;
      yield* Deferred.await(release);
      return request.build;
    }).pipe(Effect.provide(requestLayer));

    const first = next.run(handler);
    const second = next.run(handler);
    await Bun.sleep(0);
    Effect.runSync(Deferred.succeed(release, undefined));

    expect((await Promise.all([first, second])).sort()).toEqual([1, 2]);
  });

  test("runs that provide the shared layer again reuse its built instance", async () => {
    let builds = 0;
    const layer = Layer.sync(TestService, () => {
      builds += 1;
      return { value: "shared" };
    });
    const next = NextEffect.make({ layer });

    await next.run(TestService);
    await next.run(TestService.pipe(Effect.provide(layer)));

    expect(builds).toBe(1);
  });

  test("run interrupts a layer-backed effect with its signal", async () => {
    const next = NextEffect.make({
      layer: Layer.succeed(TestService, { value: "service" }),
    });
    await next.run(TestService);
    const controller = new AbortController();
    let interrupted = false;
    const result = next.run(
      Effect.never.pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            interrupted = true;
          })
        )
      ),
      { signal: controller.signal }
    );

    controller.abort();

    await expect(result).rejects.toBeDefined();
    expect(interrupted).toBe(true);
  });

  test("run preserves Next control-flow throws with a layer", async () => {
    const next = NextEffect.make({
      layer: Layer.succeed(TestService, { value: "service" }),
    });

    await expect(
      next.run(Effect.sync(() => redirect("/target")))
    ).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    await expect(next.run(Effect.sync(() => notFound()))).rejects.toMatchObject(
      {
        digest: "NEXT_HTTP_ERROR_FALLBACK;404",
      }
    );
  });

  describe("runExit", () => {
    test("resolves with the Exit of a typed failure, a defect and a layer that fails to build, never rejecting", async () => {
      const failure = { _tag: "DomainError" } as const;
      const defect = new Error("defect");
      const setup = new Error("setup");
      const next = NextEffect.make({
        layer: Layer.succeed(TestService, { value: "service" }),
      });
      const broken = NextEffect.make({
        layer: Layer.effect(TestService, Effect.fail(setup)),
      });

      const failed = await next.runExit(Effect.fail(failure));
      const died = await next.runExit(Effect.die(defect));
      const unbuilt = await broken.runExit(Effect.succeed("never"));

      expect(failed).toEqual(Exit.fail(failure));
      expect(died).toEqual(Exit.die(defect));
      expect(unbuilt).toEqual(Exit.fail(setup));
    });

    test("maps a layer build failure with mapError", async () => {
      const mapped = new Error("mapped");
      const next = NextEffect.make({
        layer: Layer.effect(TestService, Effect.fail("setup")),
        mapError: () => mapped,
      });

      expect(await next.runExit(TestService)).toEqual(Exit.fail(mapped));
    });

    test("ends in an interruption when its signal aborts", async () => {
      const next = NextEffect.make();
      const controller = new AbortController();
      const exit = next.runExit(Effect.never, { signal: controller.signal });

      controller.abort();

      expect(Exit.hasInterrupts(await exit)).toBe(true);
    });
  });

  describe("settle", () => {
    test("returns a success's value", () => {
      expect(NextEffect.settle(Exit.succeed("value"))).toBe("value");
    });

    test("throws the squashed failure", () => {
      const failure = new Error("failure");

      expect(() => NextEffect.settle(Exit.fail(failure))).toThrow(failure);
    });

    test("throws Next control flow unchanged, even after another failure", () => {
      let redirection: unknown;
      try {
        redirect("/target");
      } catch (thrown) {
        redirection = thrown;
      }
      const exit = Exit.failCause(
        Cause.fromReasons([
          Cause.makeFailReason({ _tag: "DomainError" }),
          Cause.makeDieReason(redirection),
        ])
      );

      expect(() => NextEffect.settle(exit)).toThrow(
        expect.objectContaining({
          digest: expect.stringContaining("NEXT_REDIRECT"),
        })
      );
    });
  });

  describe("request async context", () => {
    // Stands in for the Next.js request stores that revalidatePath, headers()
    // and after() read.
    const requestStore = new AsyncLocalStorage<string>();
    const readRequest = Effect.sync(() => requestStore.getStore());

    test("runs waiting for the first shared layer build resume in their own request", async () => {
      const built = Deferred.makeUnsafe<void>();
      const next = NextEffect.make({
        layer: Layer.effect(
          TestService,
          Effect.as(Deferred.await(built), { value: "service" })
        ),
      });
      const handler = Effect.andThen(TestService, readRequest);

      const first = requestStore.run("first", () => next.run(handler));
      const second = requestStore.run("second", () => next.run(handler));
      await Bun.sleep(0);
      requestStore.run("builder", () =>
        Effect.runSync(Deferred.succeed(built, undefined))
      );

      expect(await Promise.all([first, second])).toEqual(["first", "second"]);
    });

    test("a run resumed from another request's callback continues in its own request", async () => {
      // Like a pooled connection, the delivery handler belongs to the request
      // that opened it, not to the request whose callback it fires.
      const deliverFromOpener = requestStore.run("opener", () =>
        AsyncLocalStorage.bind((deliver: () => void) => deliver())
      );
      const next = NextEffect.make();
      const handler = Effect.callback<void>((resume) => {
        setImmediate(() => deliverFromOpener(() => resume(Effect.void)));
      }).pipe(Effect.andThen(readRequest));

      await expect(
        requestStore.run("caller", () => next.run(handler))
      ).resolves.toBe("caller");
    });

    test("a run waiting for a permit another request holds resumes in its own request", async () => {
      const permit = Semaphore.makeUnsafe(1);
      const released = Deferred.makeUnsafe<void>();
      const next = NextEffect.make();

      const holder = requestStore.run("holder", () =>
        next.run(permit.withPermits(1)(Deferred.await(released)))
      );
      await Bun.sleep(0);
      const waiter = requestStore.run("waiter", () =>
        next.run(permit.withPermits(1)(readRequest))
      );
      await Bun.sleep(0);
      requestStore.run("releaser", () =>
        Effect.runSync(Deferred.succeed(released, undefined))
      );

      await holder;
      await expect(waiter).resolves.toBe("waiter");
    });
  });

  test("page suspends synchronous component construction", async () => {
    const next = NextEffect.make();
    const defect = new Error("construction failed");
    const Page = next.page(() => {
      throw defect;
    });

    await expect(Page({})).rejects.toBe(defect);
  });
});
