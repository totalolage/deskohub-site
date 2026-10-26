import { afterAll, describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import * as envModule from "@/env";
import { locales } from "@/features/i18n";
import { PublishedPublicPagesService } from "@/features/public-pages/backend";
import {
  type PublicPage,
  publicPages,
} from "@/features/public-pages/public-page-definitions";

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

// Each sitemap request evaluates release gates outside the build; tests run
// outside a request, where Next's `connection()` would throw.
const nextServer = await import("next/server");
mock.module("next/server", () => ({
  ...nextServer,
  connection: () => Promise.resolve(),
}));
mock.module("@/shared/backend/workspace-effect", () => ({
  runWorkspaceEffect:
    () =>
    <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> =>
      Effect.runPromise(effect),
}));

// The service's own tests cover release-gate evaluation; here it reports
// which pages are published.
let publishedPages: ReadonlyArray<PublicPage> = publicPages;
const originalLive = PublishedPublicPagesService.Live;
Object.assign(PublishedPublicPagesService, {
  Live: Layer.succeed(PublishedPublicPagesService, {
    list: Effect.sync(() => publishedPages),
  }),
});
afterAll(() => {
  Object.assign(PublishedPublicPagesService, { Live: originalLive });
});

const { default: sitemap } = await import("./sitemap");

const productionSitemap = (pages: ReadonlyArray<PublicPage> = publicPages) => {
  vercelEnv = "production";
  publishedPages = pages;
  return sitemap();
};

const localizedUrls = (pages: ReadonlyArray<PublicPage>) =>
  pages.flatMap(({ pathname }) =>
    locales.map(
      (locale) => `${origin}/${locale}${pathname === "/" ? "" : pathname}`
    )
  );

const origin = "https://workspace.deskohub.cz";

const noindexPathnames = [
  "/account",
  "/admin",
  "/auth/callback",
  "/auth/sign-in",
  "/checkout/pay",
  "/logo",
  "/cookie-settings",
  "/reservation/access",
  "/reservation/invoice",
  "/reservation/status",
  "/testing",
];

describe("sitemap.xml", () => {
  test("lists every published page once per locale", async () => {
    const urls = (await productionSitemap()).map((entry) => entry.url);

    expect(urls).toHaveLength(new Set(urls).size);
    expect(urls.toSorted()).toEqual(localizedUrls(publicPages).toSorted());
  });

  test("leaves out a gated page production doesn't serve", async () => {
    const pages = publicPages.filter(
      ({ releaseGate }) => releaseGate !== "office-page"
    );
    const urls = (await productionSitemap(pages)).map((entry) => entry.url);

    expect(urls.toSorted()).toEqual(localizedUrls(pages).toSorted());
    expect(urls).not.toContain(`${origin}/en-US/reservation/office`);
  });

  test("gives every entry reciprocal en-US, cs-CZ and x-default alternates", async () => {
    const entries = await productionSitemap();
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

  test("dates every page's entries by its content, the same in each locale", async () => {
    const entries = await productionSitemap();
    const entriesByUrl = new Map(entries.map((entry) => [entry.url, entry]));

    for (const { pathname, contentDate } of publicPages) {
      for (const locale of locales) {
        const url = `${origin}/${locale}${pathname === "/" ? "" : pathname}`;
        expect(entriesByUrl.get(url)?.lastModified).toBe(contentDate);
      }
    }
  });

  test("keeps every URL absolute on the production origin", async () => {
    for (const entry of await productionSitemap()) {
      const urls = [
        entry.url,
        ...Object.values(entry.alternates?.languages ?? {}),
      ];
      for (const url of urls) {
        expect(new URL(url).origin).toBe(origin);
      }
    }
  });

  test("leaves out noindex pages", async () => {
    for (const entry of await productionSitemap()) {
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
    test(`is empty in ${deployment}`, async () => {
      vercelEnv = deployment;
      await expect(sitemap()).resolves.toEqual([]);
    });
  }
});
