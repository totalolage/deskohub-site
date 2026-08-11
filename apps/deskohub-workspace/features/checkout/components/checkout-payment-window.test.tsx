import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  mock,
  test,
} from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  CheckoutPaymentWindowCloser,
  closeCheckoutPaymentWindow,
  trackCheckoutPaymentWindow,
} from "./checkout-payment-window";

describe("CheckoutPaymentWindowCloser", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
    closeCheckoutPaymentWindow();
    jest.useRealTimers();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("closes the tracked payment tab after it returns to reservation status", () => {
    jest.useFakeTimers();
    let pathname: string | undefined;
    const close = mock(() => undefined);
    const paymentWindow = {
      close,
      closed: false,
      get location() {
        if (!pathname) throw new DOMException("Cross-origin", "SecurityError");
        return { pathname };
      },
    } as unknown as Window;
    trackCheckoutPaymentWindow(paymentWindow);

    render(<CheckoutPaymentWindowCloser intervalMs={100} />);

    act(() => jest.advanceTimersByTime(100));
    expect(close).not.toHaveBeenCalled();

    pathname = "/en-US/reservation/status/order-id";
    act(() => jest.advanceTimersByTime(100));

    expect(close).toHaveBeenCalledTimes(1);
  });

  test("keeps the returned tab open when the original status tab is gone", () => {
    jest.useFakeTimers();
    const closeCurrentWindow = jest.spyOn(window, "close");

    render(<CheckoutPaymentWindowCloser intervalMs={100} />);
    act(() => jest.advanceTimersByTime(500));

    expect(closeCurrentWindow).not.toHaveBeenCalled();
  });

  test("stops watching the payment tab when the original status page unmounts", () => {
    jest.useFakeTimers();
    let pathname: string | undefined;
    const close = mock(() => undefined);
    const paymentWindow = {
      close,
      closed: false,
      get location() {
        if (!pathname) throw new DOMException("Cross-origin", "SecurityError");
        return { pathname };
      },
    } as unknown as Window;
    trackCheckoutPaymentWindow(paymentWindow);
    const view = render(<CheckoutPaymentWindowCloser intervalMs={100} />);

    view.unmount();
    pathname = "/en-US/reservation/status/order-id";
    act(() => jest.advanceTimersByTime(500));

    expect(close).not.toHaveBeenCalled();
  });
});
