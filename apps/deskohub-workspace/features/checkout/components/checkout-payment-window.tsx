"use client";

import { useEffect, useRef } from "react";

const paymentWindowCheckIntervalMs = 500;
const checkoutStatusOwnerAliveMessage = "owner-alive";
const getCheckoutStatusLockName = () =>
  `deskohub:checkout-status:${window.location.pathname}`;
const getCheckoutStatusOwnerStorageKey = (pathname: string) =>
  `deskohub:checkout-status-owner:${pathname}`;
type CheckoutStatusWindowOwnership = {
  readonly ownsStatusWindow: boolean;
  readonly token?: string;
};
const consumeCheckoutStatusWindowOwner = (
  pathname: string
): CheckoutStatusWindowOwnership => {
  try {
    const storageKey = getCheckoutStatusOwnerStorageKey(pathname);
    const storedOwnership = sessionStorage.getItem(storageKey);
    sessionStorage.removeItem(storageKey);
    if (storedOwnership === "true") return { ownsStatusWindow: true };
    if (!storedOwnership) return { ownsStatusWindow: false };

    const separatorIndex = storedOwnership.indexOf(":");
    const role = storedOwnership.slice(0, separatorIndex);
    const token = storedOwnership.slice(separatorIndex + 1);
    if ((role !== "owner" && role !== "returned") || !token)
      return { ownsStatusWindow: false };
    return {
      ownsStatusWindow: role === "owner",
      token,
    };
  } catch {
    return { ownsStatusWindow: false };
  }
};

export const markCheckoutStatusWindowOwner = (
  statusUrl: string,
  paymentWindow: Window
) => {
  try {
    const pathname = new URL(statusUrl, "https://deskohub.local").pathname;
    const storageKey = getCheckoutStatusOwnerStorageKey(pathname);
    const token = crypto.randomUUID();
    paymentWindow.sessionStorage.setItem(storageKey, `returned:${token}`);
    sessionStorage.setItem(storageKey, `owner:${token}`);
  } catch {
    // Ownership coordination must not block payment navigation.
  }
};

export function CheckoutPaymentWindowCoordinator() {
  const ownershipRef = useRef<CheckoutStatusWindowOwnership | undefined>(
    undefined
  );

  useEffect(() => {
    const ownership =
      ownershipRef.current ??
      consumeCheckoutStatusWindowOwner(window.location.pathname);
    ownershipRef.current = ownership;
    let stopHeartbeat: () => void = () => undefined;
    if (ownership.token && "BroadcastChannel" in globalThis) {
      const channel = new BroadcastChannel(
        `${getCheckoutStatusLockName()}:${ownership.token}`
      );
      if (!ownership.ownsStatusWindow) {
        channel.addEventListener("message", (event) => {
          if (event.data === checkoutStatusOwnerAliveMessage) window.close();
        });
        stopHeartbeat = () => channel.close();
      } else {
        const notifyReturnedWindow = () =>
          channel.postMessage(checkoutStatusOwnerAliveMessage);
        notifyReturnedWindow();
        const interval = globalThis.setInterval(
          notifyReturnedWindow,
          paymentWindowCheckIntervalMs
        );
        stopHeartbeat = () => {
          globalThis.clearInterval(interval);
          channel.close();
        };
      }
    }
    if (!navigator.locks) return stopHeartbeat;

    let active = true;
    let releaseLock: () => void = () => undefined;
    const holdLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    navigator.locks
      .request(
        getCheckoutStatusLockName(),
        ownership.ownsStatusWindow
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
          !ownership.ownsStatusWindow &&
          cause instanceof DOMException &&
          cause.name === "AbortError"
        ) {
          window.close();
        }
      });

    return () => {
      stopHeartbeat();
      active = false;
      releaseLock();
    };
  }, []);

  return null;
}
