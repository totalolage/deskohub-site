import { afterEach, describe, expect, test } from "bun:test";
import {
  PathnameContext,
  PathParamsContext,
} from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { getLocale } from "../paraglide/runtime";
import { useLocale } from "./use-locale";

const LocaleProbe = () => <>{useLocale()}</>;

/** The locale `useLocale` returns on a route with these params and pathname. */
const localeOnRoute = (params: Record<string, string>, pathname: string) =>
  renderToStaticMarkup(
    <PathParamsContext.Provider value={params}>
      <PathnameContext.Provider value={pathname}>
        <LocaleProbe />
      </PathnameContext.Provider>
    </PathParamsContext.Provider>
  );

const globals = globalThis as { document?: unknown };

/** Gives the test a browser cookie jar holding `cookie`. */
const withBrowserCookie = (cookie: string) => {
  globals.document = { cookie };
};

afterEach(() => {
  delete globals.document;
});

describe("useLocale", () => {
  test("uses the route's locale parameter first", () => {
    withBrowserCookie("PARAGLIDE_LOCALE=cs-CZ");

    expect(localeOnRoute({ locale: "en-US" }, "/cs-CZ/menu")).toBe("en-US");
  });

  test("reads the pathname when the route has no valid locale parameter", () => {
    withBrowserCookie("PARAGLIDE_LOCALE=cs-CZ");

    expect(localeOnRoute({}, "/en-US/menu")).toBe("en-US");
    expect(localeOnRoute({ locale: "de-DE" }, "/en-US/menu")).toBe("en-US");
  });

  test("reads the locale cookie when neither the route nor the pathname names a locale", () => {
    withBrowserCookie("theme=dark; PARAGLIDE_LOCALE=en-US");

    expect(localeOnRoute({}, "/menu")).toBe("en-US");
  });

  test("falls back to Paraglide's locale without a valid route, pathname, or cookie locale", () => {
    withBrowserCookie("PARAGLIDE_LOCALE=de-DE");

    expect(localeOnRoute({}, "/menu")).toBe(getLocale());
  });
});
