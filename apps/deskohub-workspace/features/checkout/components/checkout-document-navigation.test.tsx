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

const nextLinkHrefs: string[] = [];

mock.module("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: Omit<ComponentProps<"a">, "href"> & {
    readonly children?: ReactNode;
    readonly href: string | URL;
  }) => {
    const stringHref = href.toString();
    nextLinkHrefs.push(stringHref);
    return (
      <a href={stringHref} {...props}>
        {children}
      </a>
    );
  },
}));

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

beforeEach(() => {
  nextLinkHrefs.length = 0;
});

afterEach(() => {
  cleanup();
});

afterAll(() => {
  unregisterWorkspaceComponentTestEnv();
});

test("uses document navigation to reopen a signed reservation state", async () => {
  const { CheckoutSteps } = await import("./checkout-flow-layout");
  const reservationHref = "/en-US/checkout/order?payState=encrypted-pay-state";

  const view = render(
    <CheckoutSteps
      activeStepKey="pay"
      locale="en-US"
      stepHrefs={{ order: reservationHref }}
    />
  );

  expect(
    view.getByRole("link", { name: /reservation/i }).getAttribute("href")
  ).toBe(reservationHref);
  expect(nextLinkHrefs).not.toContain(reservationHref);
});

test("uses document navigation for the failed-fulfillment support handoff", async () => {
  const { CheckoutStatusPage } = await import("./checkout-status-page");

  const view = render(
    <CheckoutStatusPage
      locale="en-US"
      status={{
        fulfillmentStatus: "failed",
        orderId: "document-navigation-order",
        paymentStatus: "paid",
        returnOutcome: "success",
        status: "fulfillment_failed",
        supportContactPrefill: {
          email: "ada@example.com",
          name: "Ada Lovelace",
          phone: "+420777777777",
        },
      }}
    />
  );
  const supportHref =
    view
      .getByRole("link", { name: "Send support request" })
      .getAttribute("href") ?? "";

  expect(supportHref).toStartWith("/en-US/contact?");
  expect(nextLinkHrefs).not.toContain(supportHref);
});
