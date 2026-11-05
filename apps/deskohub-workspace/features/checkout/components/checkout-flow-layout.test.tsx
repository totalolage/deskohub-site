import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const nextLink = await import("next/link");
mock.module("next/link", () => ({
  ...nextLink,
  default: ({
    children,
    href,
    prefetch,
    ...props
  }: Omit<ComponentProps<"a">, "href"> & {
    readonly children?: ReactNode;
    readonly href: string | URL;
    readonly prefetch?: boolean | null;
  }) => (
    <a
      data-next-link=""
      data-prefetch={String(prefetch)}
      href={href.toString()}
      {...props}
    >
      {children}
    </a>
  ),
}));

const { CheckoutFlowLayout, CheckoutSteps } = await import(
  "./checkout-flow-layout"
);

const locale = "en-US";

const getSteps = (view: ReturnType<typeof render>) => [
  ...view.container.querySelectorAll("ol > li"),
];

describe("CheckoutSteps", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("marks earlier steps completed and only the active step current", () => {
    const view = render(<CheckoutSteps activeStepKey="pay" locale={locale} />);
    const [chooseSpace, contact, pay] = getSteps(view);
    const completed = m.checkoutOrderStepCompleted({}, { locale });

    for (const step of [chooseSpace, contact]) {
      expect(step?.getAttribute("aria-current")).toBeNull();
      expect(step?.querySelector("svg[aria-hidden='true']")).not.toBeNull();
      expect(step?.querySelector(".sr-only")?.textContent).toBe(completed);
    }
    expect(pay?.getAttribute("aria-current")).toBe("step");
    expect(pay?.querySelector("svg")).toBeNull();
    expect(pay?.querySelector(".sr-only")).toBeNull();
    expect(pay?.querySelector("span")?.textContent).toBe("3");
    expect(pay?.querySelector("span")?.className).toContain("bg-burned-orange");
  });

  test("numbers upcoming steps and completes every step once the flow is done", () => {
    const upcoming = render(
      <CheckoutSteps activeStepKey="chooseSpace" locale={locale} />
    );
    const [, contact, pay] = getSteps(upcoming);
    expect(contact?.querySelector("span")?.textContent).toBe("2");
    expect(pay?.querySelector("span")?.className).toContain("border");
    expect(contact?.querySelector(".sr-only")).toBeNull();
    cleanup();

    const complete = render(
      <CheckoutSteps activeStepKey="complete" locale={locale} />
    );
    const steps = getSteps(complete);
    expect(steps).toHaveLength(3);
    for (const step of steps) {
      expect(step.getAttribute("aria-current")).toBeNull();
      expect(step.querySelector(".sr-only")).not.toBeNull();
    }
  });

  test("links each step through the control its link asks for", () => {
    const onSelect = mock(() => undefined);
    const view = render(
      <CheckoutSteps
        activeStepKey="complete"
        locale={locale}
        stepLinks={{
          chooseSpace: { href: "/en-US/reservation/cowork", prefetch: false },
          contact: {
            href: "/en-US/reservation/contact",
            navigation: "document",
          },
          pay: { onSelect },
        }}
      />
    );
    const [chooseSpace, contact, pay] = getSteps(view);

    const clientLink = chooseSpace?.firstElementChild;
    expect(clientLink?.tagName).toBe("A");
    expect(clientLink?.hasAttribute("data-next-link")).toBe(true);
    expect(clientLink?.getAttribute("href")).toBe("/en-US/reservation/cowork");
    expect(clientLink?.getAttribute("data-prefetch")).toBe("false");

    const documentLink = contact?.firstElementChild;
    expect(documentLink?.tagName).toBe("A");
    expect(documentLink?.hasAttribute("data-next-link")).toBe(false);
    expect(documentLink?.getAttribute("href")).toBe(
      "/en-US/reservation/contact"
    );

    const button = pay?.firstElementChild;
    expect(button?.tagName).toBe("BUTTON");
    expect(button?.getAttribute("type")).toBe("button");
    expect(onSelect).not.toHaveBeenCalled();
    if (button) fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  test("keeps the current step and unlinked steps as plain text", () => {
    const view = render(
      <CheckoutSteps
        activeStepKey="contact"
        locale={locale}
        stepLinks={{
          contact: { href: "/en-US/reservation/contact", navigation: "client" },
        }}
      />
    );

    for (const step of getSteps(view)) {
      expect(step.firstElementChild?.tagName).toBe("DIV");
    }
    expect(view.container.querySelector("a")).toBeNull();
  });
});

describe("CheckoutFlowLayout", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("shows breadcrumbs above the steps and the page below them", () => {
    const view = render(
      <CheckoutFlowLayout
        activeStepKey="contact"
        breadcrumbs={<nav id="crumbs" />}
        locale={locale}
      >
        <article id="page" />
      </CheckoutFlowLayout>
    );
    const children = [
      ...(view.container.querySelector("main section > div:last-child")
        ?.children ?? []),
    ].map((element) => element.id || element.tagName);

    expect(children).toEqual(["crumbs", "OL", "page"]);
  });

  test("replaces the steps for a page that changes its step in place", () => {
    const view = render(
      <CheckoutFlowLayout
        activeStepKey="contact"
        locale={locale}
        steps={<div id="custom-steps" />}
      >
        <article id="page" />
      </CheckoutFlowLayout>
    );

    expect(view.container.querySelector("#custom-steps")).not.toBeNull();
    expect(view.container.querySelector("ol")).toBeNull();
  });
});
