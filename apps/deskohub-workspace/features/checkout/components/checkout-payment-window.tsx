"use client";

import { useEffect, useRef } from "react";

const paymentWindowCheckIntervalMs = 500;
const getCheckoutStatusLockName = () =>
  `deskohub:checkout-status:${window.location.pathname}`;
const getCheckoutStatusOwnerStorageKey = (pathname: string) =>
  `deskohub:checkout-status-owner:${pathname}`;
const consumeCheckoutStatusWindowOwner = (pathname: string) => {
  try {
    const storageKey = getCheckoutStatusOwnerStorageKey(pathname);
    const ownsStatusWindow = sessionStorage.getItem(storageKey) === "true";
    sessionStorage.removeItem(storageKey);
    return ownsStatusWindow;
  } catch {
    return false;
  }
};

type CheckoutWindow = Window & {
  trackedCheckoutPaymentWindow?: {
    readonly paymentWindow: Window;
    readonly statusPathname: string;
  };
};

export const trackCheckoutPaymentWindow = (
  paymentWindow: Window,
  statusUrl: string
) => {
  (window as CheckoutWindow).trackedCheckoutPaymentWindow = {
    paymentWindow,
    statusPathname: new URL(statusUrl, "https://deskohub.local").pathname,
  };
};

const closeReturnedCheckoutPaymentWindow = () => {
  const checkoutWindow = window as CheckoutWindow;
  const trackedPaymentWindow = checkoutWindow.trackedCheckoutPaymentWindow;
  if (!trackedPaymentWindow) return;
  const { paymentWindow, statusPathname } = trackedPaymentWindow;
  if (paymentWindow.closed) {
    checkoutWindow.trackedCheckoutPaymentWindow = undefined;
    return;
  }

  try {
    if (paymentWindow.location.pathname !== statusPathname) return;
    paymentWindow.close();
    checkoutWindow.trackedCheckoutPaymentWindow = undefined;
  } catch {
    // The provider page remains cross-origin until it returns to checkout.
  }
};

export const markCheckoutStatusWindowOwner = (statusUrl: string) => {
  try {
    const pathname = new URL(statusUrl, "https://deskohub.local").pathname;
    sessionStorage.setItem(getCheckoutStatusOwnerStorageKey(pathname), "true");
  } catch {
    // Ownership coordination must not block payment navigation.
  }
};

export function CheckoutPaymentWindowCoordinator() {
  const ownsStatusWindowRef = useRef<boolean | undefined>(undefined);

  useEffect(() => {
    closeReturnedCheckoutPaymentWindow();
    const paymentWindowInterval = globalThis.setInterval(
      closeReturnedCheckoutPaymentWindow,
      paymentWindowCheckIntervalMs
    );
    const ownsStatusWindow =
      ownsStatusWindowRef.current ??
      consumeCheckoutStatusWindowOwner(window.location.pathname);
    ownsStatusWindowRef.current = ownsStatusWindow;
    if (!navigator.locks) {
      return () => globalThis.clearInterval(paymentWindowInterval);
    }

    let active = true;
    let releaseLock: () => void = () => undefined;
    const holdLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    navigator.locks
      .request(
        getCheckoutStatusLockName(),
        ownsStatusWindow
          ? { mode: "exclusive", steal: true }
          : { ifAvailable: true, mode: "exclusive" },
        (lock) => {
          if (!active) return;
          if (!lock) {
            window.close();
            return;
          }

          return holdLock;
        }
      )
      .catch((cause) => {
        if (
          active &&
          !ownsStatusWindow &&
          cause instanceof DOMException &&
          cause.name === "AbortError"
        ) {
          window.close();
        }
      });

    return () => {
      globalThis.clearInterval(paymentWindowInterval);
      active = false;
      releaseLock();
    };
  }, []);

  return null;
}
