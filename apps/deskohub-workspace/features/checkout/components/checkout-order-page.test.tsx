import { describe, expect, mock, test } from "bun:test";
import { isValidElement, type ReactNode } from "react";

mock.module("server-only", () => ({}));
mock.module("@/features/reservation/components/reservation-form", () => ({
  ReservationForm: () => null,
  ReservationFormFallback: () => null,
}));

const getFallbackProps = async () => {
  const { CheckoutOrderPage } = await import("./checkout-order-page");
  const page = CheckoutOrderPage({
    locale: "en-US",
  });

  if (!isValidElement(page)) {
    throw new Error("CheckoutOrderPage did not return a React element");
  }

  const rawChildren = (page.props as { children: ReactNode }).children;
  const children = Array.isArray(rawChildren) ? rawChildren : [rawChildren];
  const suspense = children.find(
    (child) => isValidElement(child) && "fallback" in child.props
  );

  if (!isValidElement(suspense)) {
    throw new Error("CheckoutOrderPage did not render a Suspense boundary");
  }

  const fallback = (suspense.props as { fallback: ReactNode }).fallback;

  if (!isValidElement(fallback)) {
    throw new Error("CheckoutOrderPage did not configure a React fallback");
  }

  return fallback.props as { readonly showMonitorOption?: boolean };
};

describe("CheckoutOrderPage", () => {
  test("uses a static generic reservation fallback", async () => {
    expect((await getFallbackProps()).showMonitorOption).toBe(false);
  });
});
