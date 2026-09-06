import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { ComponentProps } from "react";
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

test("formats the current Prague year with the request locale", async () => {
  const formatter = spyOn(Intl, "DateTimeFormat");
  const { PublicSiteFooter } = await import("./public-site-footer");
  const year = new Intl.DateTimeFormat("cs-CZ", {
    timeZone: workspaceSiteConstants.location.timeZone,
    year: "numeric",
  }).format();
  const view = render(await PublicSiteFooter());

  expect(
    view.getByText(
      `© ${year} ${workspaceSiteConstants.brand.legalName}. Všechna práva vyhrazena.`
    )
  ).toBeTruthy();
  expect(formatter).toHaveBeenCalledWith("cs-CZ", {
    timeZone: workspaceSiteConstants.location.timeZone,
    year: "numeric",
  });
  formatter.mockRestore();
});

test("uses guarded links for the localized internal footer destinations", async () => {
  const { PublicSiteFooter } = await import("./public-site-footer");
  render(await PublicSiteFooter());

  expect(guardedLinkHrefs).toEqual([
    "/cs-CZ/privacy-policy",
    "/cs-CZ/marketing-communications",
    "/cs-CZ/terms-and-conditions",
    "/cs-CZ/operating-rules",
    "/cs-CZ/cookie-policy",
    "/cs-CZ/cookie-settings",
    "/cs-CZ",
    "/cs-CZ/contact",
    "/cs-CZ/reservation/cowork",
  ]);
});
