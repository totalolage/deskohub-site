import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const replace = mock(() => undefined);

const setWindowUrl = (url: string) => {
  (
    window as typeof window & {
      happyDOM: { setURL: (nextUrl: string) => void };
    }
  ).happyDOM.setURL(url);
};

mock.module("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

describe("CheckoutOrderReturnRedirect", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  beforeEach(() => {
    replace.mockClear();
  });

  afterEach(() => {
    cleanup();
    setWindowUrl("https://workspace.example.test/");
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("redirects payment returns to the dynamic status route with token", async () => {
    const token = "a".repeat(43);
    setWindowUrl(
      `https://workspace.example.test/checkout/order?paymentOrderId=order_123&checkoutToken=${token}`
    );
    const { CheckoutOrderReturnRedirect } = await import(
      "./checkout-order-return-redirect"
    );

    render(<CheckoutOrderReturnRedirect locale="en-US" />);

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(
        `/en-US/checkout/status/order_123?checkoutToken=${token}`
      );
    });
  });

  test("ignores payment returns without a valid token", async () => {
    setWindowUrl(
      "https://workspace.example.test/checkout/order?paymentOrderId=order_123&checkoutToken=bad"
    );
    const { CheckoutOrderReturnRedirect } = await import(
      "./checkout-order-return-redirect"
    );

    render(<CheckoutOrderReturnRedirect locale="en-US" />);

    await Promise.resolve();
    expect(replace).not.toHaveBeenCalled();
  });
});
