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
  CheckoutPaymentWindowCoordinator,
  closeCheckoutPaymentWindow,
  trackCheckoutPaymentWindow,
} from "./checkout-payment-window";

describe("CheckoutPaymentWindowCoordinator", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
    closeCheckoutPaymentWindow();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("targets the application origin when notifying the payment tab", () => {
    jest.useFakeTimers();
    const postMessage = mock(() => undefined);
    const paymentWindow = {
      close: mock(() => undefined),
      closed: false,
      get location() {
        throw new DOMException("Cross-origin", "SecurityError");
      },
      postMessage,
    } as unknown as Window;
    trackCheckoutPaymentWindow(paymentWindow);

    render(<CheckoutPaymentWindowCoordinator intervalMs={100} />);
    act(() => jest.advanceTimersByTime(100));

    expect(postMessage).toHaveBeenCalledWith(
      "deskohub:checkout-status-tab-alive",
      window.location.origin
    );
    expect(postMessage).toHaveBeenCalledTimes(2);
  });

  test("closes the returned payment tab when the original status tab responds", () => {
    const closeCurrentWindow = jest.spyOn(window, "close");
    render(<CheckoutPaymentWindowCoordinator intervalMs={100} />);

    window.dispatchEvent(
      new MessageEvent("message", {
        data: "deskohub:checkout-status-tab-alive",
        origin: window.location.origin,
      })
    );

    expect(closeCurrentWindow).toHaveBeenCalledTimes(1);
  });

  test("keeps the returned tab open when the original status tab is gone", () => {
    jest.useFakeTimers();
    const closeCurrentWindow = jest.spyOn(window, "close");

    render(<CheckoutPaymentWindowCoordinator intervalMs={100} />);
    act(() => jest.advanceTimersByTime(500));

    expect(closeCurrentWindow).not.toHaveBeenCalled();
  });

  test("ignores unrelated cross-window messages", () => {
    const closeCurrentWindow = jest.spyOn(window, "close");
    render(<CheckoutPaymentWindowCoordinator intervalMs={100} />);

    window.dispatchEvent(
      new MessageEvent("message", {
        data: "unrelated-message",
      })
    );

    expect(closeCurrentWindow).not.toHaveBeenCalled();
  });

  test("ignores the liveness message from another origin", () => {
    const closeCurrentWindow = jest.spyOn(window, "close");
    render(<CheckoutPaymentWindowCoordinator intervalMs={100} />);

    window.dispatchEvent(
      new MessageEvent("message", {
        data: "deskohub:checkout-status-tab-alive",
        origin: "https://payment.example.com",
      })
    );

    expect(closeCurrentWindow).not.toHaveBeenCalled();
  });

  test("stops watching the payment tab when the original status page unmounts", () => {
    jest.useFakeTimers();
    const postMessage = mock(() => undefined);
    const closeCurrentWindow = jest.spyOn(window, "close");
    const paymentWindow = {
      close: mock(() => undefined),
      closed: false,
      postMessage,
    } as unknown as Window;
    trackCheckoutPaymentWindow(paymentWindow);
    const view = render(<CheckoutPaymentWindowCoordinator intervalMs={100} />);
    postMessage.mockClear();

    view.unmount();
    act(() => jest.advanceTimersByTime(500));
    window.dispatchEvent(
      new MessageEvent("message", {
        data: "deskohub:checkout-status-tab-alive",
        origin: window.location.origin,
      })
    );

    expect(postMessage).not.toHaveBeenCalled();
    expect(closeCurrentWindow).not.toHaveBeenCalled();
  });
});
