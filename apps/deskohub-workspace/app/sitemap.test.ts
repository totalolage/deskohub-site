import { describe, expect, mock, test } from "bun:test";
import * as envModule from "@/env";
import { locales, publicPagePathnames } from "@/features/i18n";

// The workspace env object is read once at import; route VERCEL_ENV through a
// switchable override so one file covers every deployment.
let vercelEnv = "production";
mock.module("@/env", () => ({
  ...envModule,
  env: new Proxy(envModule.env, {
    get: (target, key) =>
      key === "VERCEL_ENV" ? vercelEnv : Reflect.get(target, key),
  }),
}));

const { default: sitemap } = await import("./sitemap");

const productionSitemap = () => {
  vercelEnv = "production";
  return sitemap();
};

const origin = "https://workspace.deskohub.cz";

const noindexPathnames = [
  "/account",
  "/admin",
  "/auth/callback",
  "/auth/sign-in",
  "/checkout/pay",
  "/cookie-settings",
  "/gallery",
  "/reservation/access",
  "/reservation/invoice",
  "/reservation/status",
  "/testing",
];

describe("sitemap.xml", () => {
  test("lists every public page once per locale", () => {
    const urls = productionSitemap().map((entry) => entry.url);

    expect(urls).toHaveLength(new Set(urls).size);
    expect(urls.toSorted()).toEqual(
      publicPagePathnames
        .flatMap((pathname) =>
          locales.map(
            (locale) => `${origin}/${locale}${pathname === "/" ? "" : pathname}`
          )
        )
        .toSorted()
    );
  });

  test("gives every entry reciprocal en-US, cs-CZ and x-default alternates", () => {
    const entries = productionSitemap();
    const entriesByUrl = new Map(entries.map((entry) => [entry.url, entry]));

    for (const entry of entries) {
      const languages = entry.alternates?.languages ?? {};
      expect(Object.keys(languages).toSorted()).toEqual(
        ["cs-CZ", "en-US", "x-default"].toSorted()
      );
      expect(Object.values(languages)).toContain(entry.url);

      for (const locale of locales) {
        const alternate = entriesByUrl.get(languages[locale] ?? "");
        expect(alternate?.alternates?.languages).toEqual(languages);
      }

      const localePrefix = new RegExp(`^/(${locales.join("|")})(?=/|$)`);
      const unprefixed = new URL(entry.url).pathname.replace(localePrefix, "");
      expect(languages["x-default"]).toBe(`${origin}${unprefixed || "/"}`);
    }
  });

  test("keeps every URL absolute on the production origin", () => {
    for (const entry of productionSitemap()) {
      const urls = [
        entry.url,
        ...Object.values(entry.alternates?.languages ?? {}),
      ];
      for (const url of urls) {
        expect(new URL(url).origin).toBe(origin);
      }
    }
  });

  test("leaves out noindex pages", () => {
    for (const entry of productionSitemap()) {
      const urls = [
        entry.url,
        ...Object.values(entry.alternates?.languages ?? {}),
      ];
      for (const url of urls) {
        const { pathname } = new URL(url);
        for (const noindexPathname of noindexPathnames) {
          expect(pathname).not.toMatch(
            new RegExp(`^(/(${locales.join("|")}))?${noindexPathname}(/|$)`)
          );
        }
      }
    }
  });

  for (const deployment of ["preview", "development"]) {
    test(`is empty in ${deployment}`, () => {
      vercelEnv = deployment;
      expect(sitemap()).toEqual([]);
    });
  }
});
