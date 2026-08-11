"use client";

import { useEffect } from "react";

type CheckoutPaymentWindowCoordinatorProps = {
  readonly intervalMs?: number;
};

const DEFAULT_PAYMENT_WINDOW_CHECK_INTERVAL_MS = 500;
const checkoutStatusTabAliveMessage = "deskohub:checkout-status-tab-alive";

let checkoutPaymentWindow: Window | null = null;

export const trackCheckoutPaymentWindow = (paymentWindow: Window) => {
  checkoutPaymentWindow = paymentWindow;
};

export const closeCheckoutPaymentWindow = () => {
  checkoutPaymentWindow?.close();
  checkoutPaymentWindow = null;
};

const notifyCheckoutPaymentWindow = () => {
  if (!checkoutPaymentWindow) return;
  if (checkoutPaymentWindow.closed) {
    checkoutPaymentWindow = null;
    return;
  }

  try {
    checkoutPaymentWindow.postMessage(checkoutStatusTabAliveMessage, "*");
  } catch {
    checkoutPaymentWindow = null;
  }
};

export function CheckoutPaymentWindowCoordinator({
  intervalMs = DEFAULT_PAYMENT_WINDOW_CHECK_INTERVAL_MS,
}: CheckoutPaymentWindowCoordinatorProps) {
  useEffect(() => {
    const closeReturnedPaymentTab = (event: MessageEvent) => {
      if (event.data !== checkoutStatusTabAliveMessage) return;
      window.close();
    };

    window.addEventListener("message", closeReturnedPaymentTab);
    notifyCheckoutPaymentWindow();
    const intervalId = globalThis.setInterval(
      notifyCheckoutPaymentWindow,
      intervalMs
    );

    return () => {
      window.removeEventListener("message", closeReturnedPaymentTab);
      globalThis.clearInterval(intervalId);
    };
  }, [intervalMs]);

  return null;
}
