import { describe, expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  createRequestLocaleScope,
  scopeAmbientLocaleToRequest,
} from "./request-locale";
import { createTestParaglideRuntime } from "./testing/paraglide-runtime";

type Locale = "cs-CZ" | "en-US";

function createRuntime() {
  const runtime = createTestParaglideRuntime<Locale>("cs-CZ");
  const scope = createRequestLocaleScope<Locale>({
    origin: "https://example.test",
    overwriteServerAsyncLocalStorage: runtime.overwriteServerAsyncLocalStorage,
  });

  return { runtime, scope };
}

describe("createRequestLocaleScope", () => {
  test("provides the locale and origin to Paraglide across async continuations", async () => {
    const { runtime, scope } = createRuntime();

    const locale = await scope.runWithLocale("en-US", async () => {
      await Promise.resolve();
      return runtime.getLocale();
    });

    expect(locale).toBe("en-US");
    expect(runtime.getLocale()).toBe("cs-CZ");
  });
});

describe("scopeAmbientLocaleToRequest", () => {
  // Stands in for React's request-scoped `cache`, one store per render.
  function createAmbientRuntime() {
    const { runtime, scope } = createRuntime();
    const renders = new AsyncLocalStorage<{ locale?: Locale }>();
    scopeAmbientLocaleToRequest(scope, runtime, () => renders.getStore() ?? {});

    return {
      runtime,
      scope,
      render: <A>(callback: () => Promise<A>) => renders.run({}, callback),
    };
  }

  test("a locale set during one render does not reach a later render", async () => {
    const { runtime, render } = createAmbientRuntime();

    await render(async () => runtime.setLocale("en-US", { reload: false }));

    await expect(render(async () => runtime.getLocale())).resolves.toBe(
      "cs-CZ"
    );
    expect(runtime.getLocale()).toBe("cs-CZ");
    expect(runtime.extractLocaleFromRequest({})).toBe("cs-CZ");
  });

  test("overlapping renders each read the locale they set", async () => {
    const { runtime, render } = createAmbientRuntime();
    const bothSet = Promise.withResolvers<void>();
    let set = 0;
    const renderIn = (locale: Locale) =>
      render(async () => {
        runtime.setLocale(locale, { reload: false });
        set += 1;
        if (set === 2) bothSet.resolve();
        await bothSet.promise;
        return runtime.getLocale();
      });

    await expect(
      Promise.all([renderIn("cs-CZ"), renderIn("en-US")])
    ).resolves.toEqual(["cs-CZ", "en-US"]);
  });

  test("a scoped locale wins over the render locale", async () => {
    const { runtime, scope, render } = createAmbientRuntime();

    const locale = await render(async () => {
      runtime.setLocale("cs-CZ", { reload: false });
      return scope.runWithLocale("en-US", () => runtime.getLocale());
    });

    expect(locale).toBe("en-US");
  });
});
