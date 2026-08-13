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
import { cleanup, render, waitFor } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { CheckoutPaymentWindowCoordinator } from "./checkout-payment-window";

type LockRequestCallback = (lock: Lock | null) => Promise<void> | void;

let originalLocksDescriptor: PropertyDescriptor | undefined;
const getCheckoutStatusOwnerStorageKey = () =>
  `deskohub:checkout-status-owner:${window.location.pathname}`;

const installLockManager = (
  lock: Lock | null,
  onReleased: () => void = () => undefined
) => {
  const request = mock(
    (
      _name: string,
      _options: {
        readonly ifAvailable?: boolean;
        readonly mode?: LockMode;
        readonly steal?: boolean;
      },
      callback: LockRequestCallback
    ) => Promise.resolve(callback(lock)).then(onReleased)
  );
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: { request },
  });
  return request;
};

describe("CheckoutPaymentWindowCoordinator", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
    originalLocksDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "locks"
    );
  });

  afterEach(() => {
    cleanup();
    sessionStorage.removeItem(getCheckoutStatusOwnerStorageKey());
    jest.restoreAllMocks();
    if (originalLocksDescriptor) {
      Object.defineProperty(navigator, "locks", originalLocksDescriptor);
    } else {
      Reflect.deleteProperty(navigator, "locks");
    }
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("holds the reservation status lock until the original tab unmounts", async () => {
    let released = false;
    const request = installLockManager(
      {
        name: "checkout-status",
        mode: "exclusive",
      },
      () => {
        released = true;
      }
    );
    const closeCurrentWindow = jest.spyOn(window, "close");
    const view = render(<CheckoutPaymentWindowCoordinator />);

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(request).toHaveBeenCalledWith(
      `deskohub:checkout-status:${window.location.pathname}`,
      { ifAvailable: true, mode: "exclusive" },
      expect.any(Function)
    );
    expect(closeCurrentWindow).not.toHaveBeenCalled();

    view.unmount();
    await waitFor(() => expect(released).toBe(true));
  });

  test("lets the original status tab preempt a returned tab that hydrated first", async () => {
    sessionStorage.setItem(getCheckoutStatusOwnerStorageKey(), "true");
    const request = installLockManager({
      name: "checkout-status",
      mode: "exclusive",
    });

    render(<CheckoutPaymentWindowCoordinator />);

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(
      sessionStorage.getItem(getCheckoutStatusOwnerStorageKey())
    ).toBeNull();
    expect(request).toHaveBeenCalledWith(
      `deskohub:checkout-status:${window.location.pathname}`,
      { mode: "exclusive", steal: true },
      expect.any(Function)
    );
  });

  test("closes the returned payment tab when the original owns the lock", async () => {
    installLockManager(null);
    const closeCurrentWindow = jest.spyOn(window, "close");

    render(<CheckoutPaymentWindowCoordinator />);

    await waitFor(() => expect(closeCurrentWindow).toHaveBeenCalledTimes(1));
  });

  test("closes a returned tab when the original preempts its lock", async () => {
    const request = mock(
      (_name: string, _options: LockOptions, callback: LockRequestCallback) => {
        callback({ name: "checkout-status", mode: "exclusive" });
        return Promise.reject(new DOMException("Lock stolen", "AbortError"));
      }
    );
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request },
    });
    const closeCurrentWindow = jest.spyOn(window, "close");

    render(<CheckoutPaymentWindowCoordinator />);

    await waitFor(() => expect(closeCurrentWindow).toHaveBeenCalledTimes(1));
  });

  test("keeps the returned tab open when the original status tab is gone", async () => {
    const request = installLockManager({
      name: "checkout-status",
      mode: "exclusive",
    });
    const closeCurrentWindow = jest.spyOn(window, "close");

    render(<CheckoutPaymentWindowCoordinator />);

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(closeCurrentWindow).not.toHaveBeenCalled();
  });

  test("does not let a same-origin window close the status tab by message", async () => {
    const request = installLockManager({
      name: "checkout-status",
      mode: "exclusive",
    });
    const closeCurrentWindow = jest.spyOn(window, "close");

    render(<CheckoutPaymentWindowCoordinator />);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    window.dispatchEvent(
      new MessageEvent("message", {
        data: "deskohub:checkout-status-tab-alive",
        origin: window.location.origin,
      })
    );

    expect(closeCurrentWindow).not.toHaveBeenCalled();
  });

  test("keeps the status tab open when Web Locks are unavailable", () => {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    });
    const closeCurrentWindow = jest.spyOn(window, "close");

    render(<CheckoutPaymentWindowCoordinator />);

    expect(closeCurrentWindow).not.toHaveBeenCalled();
  });
});
