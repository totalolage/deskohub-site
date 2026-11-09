import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  mock,
  test,
} from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { cleanup, fireEvent, render } from "@testing-library/react";
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

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

test("uses a document navigation to reopen signed reservation state", async () => {
  const { CheckoutSteps } = await import("./checkout-flow-layout");
  const reservationHref =
    "/en-US/reservation/cowork?payState=encrypted-pay-state";

  const view = render(
    <CheckoutSteps
      activeStepKey="pay"
      locale="en-US"
      stepLinks={{
        chooseSpace: { href: reservationHref, navigation: "document" },
        contact: {
          href: `${reservationHref}&step=contact`,
          navigation: "document",
        },
      }}
    />
  );

  expect(
    view.getByRole("link", { name: /choose your space/i }).getAttribute("href")
  ).toBe(reservationHref);
  expect(
    view.getByRole("link", { name: /contact details/i }).getAttribute("href")
  ).toBe(`${reservationHref}&step=contact`);
  expect(capturedLinks).toBeEmpty();
});

test("shows every step completed once the reservation is booked", async () => {
  const { CheckoutSteps } = await import("./checkout-flow-layout");

  const view = render(
    <CheckoutSteps activeStepKey="complete" locale="en-US" />
  );

  expect(view.getAllByRole("listitem")).toHaveLength(3);
  expect(view.getAllByText("Completed")).toHaveLength(3);
  expect(view.container.querySelector('[aria-current="step"]')).toBeNull();
});

test("changes a step in place without navigating", async () => {
  const { CheckoutSteps } = await import("./checkout-flow-layout");
  const onSelect = mock(() => undefined);

  const view = render(
    <CheckoutSteps
      activeStepKey="contact"
      locale="en-US"
      stepLinks={{ chooseSpace: { onSelect } }}
    />
  );

  fireEvent.click(view.getByRole("button", { name: /choose your space/i }));
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(capturedLinks).toBeEmpty();
});

test("opens failed-delivery support without starting another purchase", async () => {
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
          email: testEmailAddress("ada"),
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
  expect(
    view.queryByRole("link", { name: "Start a new reservation" })
  ).toBeNull();
  expect(capturedLinks).toContainEqual({
    href: "/en-US",
    prefetch: false,
  });
});

test("starts a new reservation with a fresh document", async () => {
  const { CheckoutStatusPage } = await import("./checkout-status-page");

  const view = render(
    <CheckoutStatusPage
      locale="en-US"
      status={{
        fulfillmentStatus: "not_started",
        kind: "cowork",
        orderId: "next-navigation-order",
        paymentStatus: "failed",
        returnOutcome: "success",
        status: "payment_failed",
      }}
    />
  );

  expect(
    view.getByRole("link", { name: "Try again" }).getAttribute("href")
  ).toBe("/en-US/reservation/cowork");
  expect(
    capturedLinks.some(({ href }) => href === "/en-US/reservation/cowork")
  ).toBe(false);
  expect(capturedLinks).toContainEqual({
    href: "/en-US",
    prefetch: false,
  });
});
