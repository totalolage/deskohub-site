import { describe, expect, test } from "bun:test";
import { Context, Effect } from "effect";
import { createParaglideLocaleBridge } from "./effect";
import { createRequestLocaleScope } from "./request-locale";
import { createTestParaglideRuntime } from "./testing/paraglide-runtime";

type Locale = "cs-CZ" | "en-US";

class TestLocale extends Context.Service<TestLocale, Locale>()("TestLocale") {}

function createBridge() {
  const runtime = createTestParaglideRuntime<Locale>("cs-CZ");
  const bridge = createParaglideLocaleBridge({
    localeTag: TestLocale,
    scope: createRequestLocaleScope({
      overwriteServerAsyncLocalStorage:
        runtime.overwriteServerAsyncLocalStorage,
    }),
  });

  return { runtime, runWithLocale: bridge.runWithLocale };
}

describe("createParaglideLocaleBridge", () => {
  test("runWithLocale provides the locale to the Effect and to Paraglide", async () => {
    const { runtime, runWithLocale } = createBridge();

    const result = await Effect.runPromise(
      runWithLocale(
        Effect.gen(function* () {
          yield* Effect.promise(() => Promise.resolve());
          return {
            locale: yield* TestLocale,
            messageLocale: runtime.getLocale(),
          };
        })
      ).pipe(Effect.provideService(TestLocale, "en-US"))
    );

    expect(result).toEqual({ locale: "en-US", messageLocale: "en-US" });
  });

  test("overlapping requests each read their own locale", async () => {
    const { runtime, runWithLocale } = createBridge();
    const bothStarted = Promise.withResolvers<void>();
    let started = 0;
    const readLocale = (locale: Locale) =>
      Effect.runPromise(
        runWithLocale(
          Effect.promise(async () => {
            started += 1;
            if (started === 2) bothStarted.resolve();
            await bothStarted.promise;
            return runtime.getLocale();
          })
        ).pipe(Effect.provideService(TestLocale, locale))
      );

    await expect(
      Promise.all([readLocale("cs-CZ"), readLocale("en-US")])
    ).resolves.toEqual(["cs-CZ", "en-US"]);
  });
});
