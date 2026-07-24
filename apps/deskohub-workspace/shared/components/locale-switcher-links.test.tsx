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
  usePathname: () => "/en-US",
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
});

afterEach(() => {
  cleanup();
});

afterAll(() => {
  unregisterWorkspaceComponentTestEnv();
});

test("disables prefetch for every alternate-locale header link", async () => {
  const { SiteHeader } = await import("./site-header");

  render(
    <SiteHeader
      contactHref="/en-US/contact"
      contactLabel="Contact"
      currentLocale="en-US"
      languageLabels={{ "cs-CZ": "Czech", "en-US": "English" }}
      links={[]}
    />
  );

  const alternateLocaleLinks = capturedLinks.filter(
    ({ href }) => href === "/cs-CZ"
  );

  expect(alternateLocaleLinks).toHaveLength(2);
  expect(alternateLocaleLinks.every(({ prefetch }) => prefetch === false)).toBe(
    true
  );
});

test("keeps alternate-locale prefetch disabled in the minimal header", async () => {
  const { MinimalSiteHeader } = await import("./minimal-site-header");

  render(
    <MinimalSiteHeader
      currentLocale="en-US"
      languageLabels={{ "cs-CZ": "Czech", "en-US": "English" }}
    />
  );

  expect(capturedLinks.filter(({ href }) => href === "/cs-CZ")).toEqual([
    { href: "/cs-CZ", prefetch: false },
  ]);
});
