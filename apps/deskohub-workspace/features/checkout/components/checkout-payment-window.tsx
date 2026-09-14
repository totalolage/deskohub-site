"use client";

import { useEffect, useRef } from "react";
import { coordinateReturnWindow } from "@/shared/browser/return-window";

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
    const ownsStatusWindow =
      ownsStatusWindowRef.current ??
      consumeCheckoutStatusWindowOwner(window.location.pathname);
    ownsStatusWindowRef.current = ownsStatusWindow;
    return coordinateReturnWindow({
      key: getCheckoutStatusLockName(),
      onDuplicate: () => window.close(),
      owner: ownsStatusWindow,
    });
  }, []);

  return null;
}
