import { describe, expect, mock, test } from "bun:test";
import { Context, Effect } from "effect";
import { createParaglideLocaleBridge } from "./effect";

class TestLocale extends Context.Service<
  TestLocale,
  "en" | "cs"
>()("TestLocale") {}

describe("createParaglideLocaleBridge", () => {
  test("runWithLocale sets locale, provides it, and exposes async local storage", async () => {
    let overwrittenStorage: unknown;
    const setLocale = mock(() => undefined);
    const bridge = createParaglideLocaleBridge({
      localeTag: TestLocale,
      origin: "https://example.test",
      setLocale,
      overwriteServerAsyncLocalStorage: (storage) => {
        overwrittenStorage = storage;
      },
    });

    const result = await Effect.runPromise(
      bridge
        .runWithLocale(
          Effect.gen(function* () {
            const locale = yield* TestLocale;
            return {
              locale,
              store: bridge.localeAsyncLocalStorage.getStore(),
            };
          })
        )
        .pipe(Effect.provideService(TestLocale, "cs"))
    );

    expect(setLocale).toHaveBeenCalledWith("cs", { reload: false });
    expect(overwrittenStorage).toBe(bridge.localeAsyncLocalStorage);
    expect(result).toEqual({
      locale: "cs",
      store: { locale: "cs", origin: "https://example.test" },
    });
  });
});
