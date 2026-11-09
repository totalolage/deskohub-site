import { describe, expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { createSafeActionClient } from "next-safe-action";
import { createLocaleActionMiddleware } from "./action";
import { createRequestLocaleScope } from "./request-locale";
import { createTestParaglideRuntime } from "./testing/paraglide-runtime";

type Locale = "cs-CZ" | "en-US";
type TestRequest = { localeCookie?: Locale };

function createLocalizedActionClient() {
  const runtime = createTestParaglideRuntime<Locale>("cs-CZ");
  const requests = new AsyncLocalStorage<TestRequest>();
  const localeMiddleware = createLocaleActionMiddleware({
    resolveLocale: () =>
      runtime.extractLocaleFromRequest(requests.getStore() ?? {}),
    fallbackLocale: runtime.baseLocale,
    scope: createRequestLocaleScope({
      overwriteServerAsyncLocalStorage:
        runtime.overwriteServerAsyncLocalStorage,
    }),
  });

  return {
    runtime,
    actionClient: createSafeActionClient().use(localeMiddleware),
    request: <T>(request: TestRequest, callback: () => Promise<T>) =>
      requests.run(request, callback),
  };
}

describe("createLocaleActionMiddleware", () => {
  test("a request without a locale cookie keeps the default after another request chose English", async () => {
    const { runtime, actionClient, request } = createLocalizedActionClient();
    const readLocale = actionClient.action(async ({ ctx }) => ({
      contextLocale: ctx.locale,
      messageLocale: runtime.getLocale(),
    }));

    await request({ localeCookie: "en-US" }, () => readLocale());
    const result = await request({}, () => readLocale());

    expect(result.data).toEqual({
      contextLocale: "cs-CZ",
      messageLocale: "cs-CZ",
    });
  });

  test("overlapping requests each read their own locale", async () => {
    const { runtime, actionClient, request } = createLocalizedActionClient();
    const bothStarted = Promise.withResolvers<void>();
    let started = 0;
    const readLocale = actionClient.action(async ({ ctx }) => {
      started += 1;
      if (started === 2) bothStarted.resolve();
      await bothStarted.promise;

      return { contextLocale: ctx.locale, messageLocale: runtime.getLocale() };
    });

    const [czech, english] = await Promise.all([
      request({ localeCookie: "cs-CZ" }, () => readLocale()),
      request({ localeCookie: "en-US" }, () => readLocale()),
    ]);

    expect(czech.data).toEqual({
      contextLocale: "cs-CZ",
      messageLocale: "cs-CZ",
    });
    expect(english.data).toEqual({
      contextLocale: "en-US",
      messageLocale: "en-US",
    });
  });
});
