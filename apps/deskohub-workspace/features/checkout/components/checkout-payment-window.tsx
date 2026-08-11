"use client";

import { useEffect } from "react";
import { reservationStatusPath } from "@/features/reservation/routes";

type CheckoutPaymentWindowCloserProps = {
  readonly intervalMs?: number;
};

const DEFAULT_PAYMENT_WINDOW_CHECK_INTERVAL_MS = 500;

let checkoutPaymentWindow: Window | null = null;

export const trackCheckoutPaymentWindow = (paymentWindow: Window) => {
  checkoutPaymentWindow = paymentWindow;
};

export const closeCheckoutPaymentWindow = () => {
  checkoutPaymentWindow?.close();
  checkoutPaymentWindow = null;
};

const closeReturnedCheckoutPaymentWindow = () => {
  if (!checkoutPaymentWindow) return;
  if (checkoutPaymentWindow.closed) {
    checkoutPaymentWindow = null;
    return;
  }

  try {
    if (
      !checkoutPaymentWindow.location.pathname.includes(
        `${reservationStatusPath}/`
      )
    ) {
      return;
    }
  } catch {
    return;
  }

  closeCheckoutPaymentWindow();
};

export function CheckoutPaymentWindowCloser({
  intervalMs = DEFAULT_PAYMENT_WINDOW_CHECK_INTERVAL_MS,
}: CheckoutPaymentWindowCloserProps) {
  useEffect(() => {
    closeReturnedCheckoutPaymentWindow();
    const intervalId = globalThis.setInterval(
      closeReturnedCheckoutPaymentWindow,
      intervalMs
    );

    return () => globalThis.clearInterval(intervalId);
  }, [intervalMs]);

  return null;
}
