import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

type CapturedLink = {
  readonly href: string;
  readonly prefetch: boolean | null | undefined;
};

const capturedLinks: CapturedLink[] = [];
let currentPathname = "/en-US";

mock.module("next/link", () => ({
  default: ({
    children,
    href,
    prefetch,
    scroll: _scroll,
    ...props
  }: Omit<ComponentProps<"a">, "href"> & {
    readonly children?: ReactNode;
    readonly href: string | URL;
    readonly prefetch?: boolean | null;
    readonly scroll?: boolean;
  }) => {
    const stringHref = href.toString();
    capturedLinks.push({ href: stringHref, prefetch });

    return (
      <a href={stringHref} {...props}>
        {children}
      </a>
    );
  },
}));

mock.module("next/navigation", () => ({
  usePathname: () => currentPathname,
  useSearchParams: () => new URLSearchParams(),
}));

mock.module("@/shared/components/logo", () => ({
  HorizontalLogo: () => <span>Deskohub Workspace</span>,
}));

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

beforeEach(() => {
  capturedLinks.length = 0;
  currentPathname = "/en-US";
});

afterEach(() => {
  cleanup();
});

afterAll(() => {
  unregisterWorkspaceComponentTestEnv();
});

test("uses document navigation for every alternate-locale full-header link", async () => {
  const { SiteHeader } = await import("./site-header");

  for (const { alternateHref, contactHref, currentLocale, pathname } of [
    {
      alternateHref: "/cs-CZ",
      contactHref: "/en-US/contact",
      currentLocale: "en-US",
      pathname: "/en-US",
    },
    {
      alternateHref: "/en-US",
      contactHref: "/cs-CZ/contact",
      currentLocale: "cs-CZ",
      pathname: "/cs-CZ",
    },
  ] as const) {
    currentPathname = pathname;
    capturedLinks.length = 0;
    const view = render(
      <SiteHeader
        accountHref={`/${currentLocale}/account`}
        accountLabel="Account"
        contactHref={contactHref}
        contactLabel="Contact"
        currentLocale={currentLocale}
        languageLabels={{ "cs-CZ": "Czech", "en-US": "English" }}
        links={[]}
      />
    );

    expect(
      view.container.querySelectorAll(`a[href="${alternateHref}"]`)
    ).toHaveLength(2);
    expect(capturedLinks.filter(({ href }) => href === alternateHref)).toEqual(
      []
    );
    view.unmount();
  }
});

test("renders only the configured full-header items without reserved slots", async () => {
  const { SiteHeader } = await import("./site-header");
  const galleryHref = "/en-US/gallery";
  const view = render(
    <SiteHeader
      accountHref="/en-US/account"
      accountLabel="Account"
      contactHref="/en-US/reservation/cowork"
      contactLabel="Book"
      currentLocale="en-US"
      languageLabels={{ "cs-CZ": "Czech", "en-US": "English" }}
      links={[
        {
          id: "gallery",
          href: galleryHref,
          label: "Gallery",
        },
      ]}
    />
  );

  const desktopNavigation = view.container.querySelector(
    'nav[aria-label="Primary"]'
  );
  expect(desktopNavigation?.getAttribute("class")).toContain("gap-6");
  expect(desktopNavigation?.getAttribute("class")).toContain("xl:flex");
  expect(desktopNavigation?.getAttribute("class")).not.toContain("grid");
  expect(
    desktopNavigation
      ?.querySelector(`a[href="${galleryHref}"]`)
      ?.getAttribute("class")
  ).not.toContain("col-start");
});

test("uses document navigation for the alternate-locale minimal-header link", async () => {
  const { MinimalSiteHeader } = await import("./minimal-site-header");

  for (const { alternateHref, currentLocale, pathname } of [
    {
      alternateHref: "/cs-CZ",
      currentLocale: "en-US",
      pathname: "/en-US",
    },
    {
      alternateHref: "/en-US",
      currentLocale: "cs-CZ",
      pathname: "/cs-CZ",
    },
  ] as const) {
    currentPathname = pathname;
    capturedLinks.length = 0;
    const view = render(
      <MinimalSiteHeader
        currentLocale={currentLocale}
        languageLabels={{ "cs-CZ": "Czech", "en-US": "English" }}
      />
    );

    expect(
      view.container.querySelectorAll(`a[href="${alternateHref}"]`)
    ).toHaveLength(1);
    expect(capturedLinks.filter(({ href }) => href === alternateHref)).toEqual(
      []
    );
    expect(capturedLinks).toContainEqual({
      href: `/${currentLocale}`,
      prefetch: false,
    });
    view.unmount();
  }
});
