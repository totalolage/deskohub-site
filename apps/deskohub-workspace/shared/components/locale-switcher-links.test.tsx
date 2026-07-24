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

test("uses document navigation for every alternate-locale full-header link", async () => {
  const { SiteHeader } = await import("./site-header");

  const view = render(
    <SiteHeader
      contactHref="/en-US/contact"
      contactLabel="Contact"
      currentLocale="en-US"
      languageLabels={{ "cs-CZ": "Czech", "en-US": "English" }}
      links={[]}
    />
  );

  expect(view.container.querySelectorAll('a[href="/cs-CZ"]')).toHaveLength(2);
  expect(capturedLinks.filter(({ href }) => href === "/cs-CZ")).toEqual([]);
});

test("uses document navigation for the alternate-locale minimal-header link", async () => {
  const { MinimalSiteHeader } = await import("./minimal-site-header");

  const view = render(
    <MinimalSiteHeader
      currentLocale="en-US"
      languageLabels={{ "cs-CZ": "Czech", "en-US": "English" }}
    />
  );

  expect(view.container.querySelectorAll('a[href="/cs-CZ"]')).toHaveLength(1);
  expect(capturedLinks.filter(({ href }) => href === "/cs-CZ")).toEqual([]);
});
