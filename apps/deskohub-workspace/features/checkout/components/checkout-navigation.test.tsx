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
    ...props
  }: Omit<ComponentProps<"a">, "href"> & {
    readonly children?: ReactNode;
    readonly href: string | URL;
    readonly prefetch?: boolean | null;
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

test("uses a Next Link without prefetch to reopen signed reservation state", async () => {
  const { CheckoutSteps } = await import("./checkout-flow-layout");
  const reservationHref =
    "/en-US/reservation/cowork?payState=encrypted-pay-state";

  render(
    <CheckoutSteps
      activeStepKey="pay"
      locale="en-US"
      stepLinks={{
        order: {
          href: reservationHref,
          prefetch: false,
        },
      }}
    />
  );

  expect(capturedLinks).toContainEqual({
    href: reservationHref,
    prefetch: false,
  });
});

test("keeps status-page actions as Next Links without background prefetch", async () => {
  const { CheckoutStatusPage } = await import("./checkout-status-page");

  const view = render(
    <CheckoutStatusPage
      locale="en-US"
      status={{
        fulfillmentStatus: "failed",
        kind: "cowork",
        orderId: "next-navigation-order",
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
  expect(capturedLinks).toContainEqual({
    href: supportHref,
    prefetch: false,
  });
  expect(capturedLinks).toContainEqual({
    href: "/en-US/reservation/cowork",
    prefetch: false,
  });
  expect(capturedLinks).toContainEqual({
    href: "/en-US",
    prefetch: false,
  });
});
