import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  mock,
  setSystemTime,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { workspaceSiteConstants } from "@/shared/utils";

const guardedLinkHrefs: string[] = [];

mock.module("next/cache", () => ({ cacheLife: () => undefined }));
mock.module("@/features/i18n/server/request-locale", () => ({
  getRequestLocale: () => Promise.resolve("cs-CZ"),
}));
mock.module("@/shared/components/guarded-link", () => ({
  GuardedLink: ({
    children,
    href,
    prefetch: _prefetch,
    ...props
  }: Omit<ComponentProps<"a">, "href"> & {
    readonly href: string | URL;
    readonly prefetch?: boolean | "auto" | null;
  }) => {
    guardedLinkHrefs.push(href.toString());

    return (
      <a href={href.toString()} {...props}>
        {children}
      </a>
    );
  },
}));

beforeAll(registerWorkspaceComponentTestEnv);
beforeEach(() => {
  guardedLinkHrefs.length = 0;
});
afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

test("advances the copyright year at the Prague new year", async () => {
  // 23:30 UTC on 31 December is already 00:30 on 1 January in Prague.
  setSystemTime(new Date("2026-12-31T23:30:00Z"));
  const { PublicSiteFooter } = await import("./public-site-footer");

  try {
    const view = render(await PublicSiteFooter());

    expect(
      view.getByText(
        m.footerCopyright(
          {
            companyName: workspaceSiteConstants.brand.legalName,
            year: "2027",
          },
          { locale: "cs-CZ" }
        )
      )
    ).toBeTruthy();
  } finally {
    setSystemTime();
  }
});

test("routes every internal footer page link through a locale-prefixed guarded link", async () => {
  const { PublicSiteFooter } = await import("./public-site-footer");
  const view = render(await PublicSiteFooter());
  const internalPageHrefs = Array.from(
    view.container.querySelectorAll('a[href^="/"]:not([download])'),
    (link) => link.getAttribute("href")
  );

  expect(internalPageHrefs.length).toBeGreaterThan(0);
  expect<readonly (string | null)[]>(guardedLinkHrefs).toEqual(
    internalPageHrefs
  );
  for (const href of guardedLinkHrefs) {
    expect(href === "/cs-CZ" || href.startsWith("/cs-CZ/")).toBe(true);
  }
});

test("links the prices and opening hours page", async () => {
  const { PublicSiteFooter } = await import("./public-site-footer");
  const view = render(await PublicSiteFooter());

  expect(
    view
      .getByRole("link", {
        name: m.footerPricingLink({}, { locale: "cs-CZ" }),
      })
      .getAttribute("href")
  ).toBe("/cs-CZ/pricing");
});
