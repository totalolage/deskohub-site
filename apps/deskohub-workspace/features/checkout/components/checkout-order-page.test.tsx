import { describe, expect, mock, test } from "bun:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";

mock.module("server-only", () => ({}));
mock.module("@/features/reservation/components/reservation-form", () => ({
  ReservationForm: () => null,
  ReservationFormFallback: () => null,
}));

const initialAvailabilityQuery = {
  from: "2026-01-01",
  to: "2026-07-01",
  entryTier: "basic",
} as const;

const initialAvailability = {
  from: initialAvailabilityQuery.from,
  to: initialAvailabilityQuery.to,
  unavailableDates: [],
  unavailableTiers: [],
  unavailableMonitorOptions: [],
  notices: [],
} as const;

const getFallbackProps = async (
  searchParams: Record<string, string | undefined>
) => {
  const { CheckoutOrderPage } = await import("./checkout-order-page");
  const page = CheckoutOrderPage({
    initialAvailability,
    locale: "en-US",
    searchParams,
  });

  if (!isValidElement(page)) {
    throw new Error("CheckoutOrderPage did not return a React element");
  }

  const suspense = (page.props as { children: ReactElement }).children;
  const fallback = (suspense.props as { fallback: ReactNode }).fallback;

  if (!isValidElement(fallback)) {
    throw new Error("CheckoutOrderPage did not configure a React fallback");
  }

  return fallback.props as { readonly showMonitorOption?: boolean };
};

describe("CheckoutOrderPage", () => {
  test("reserves monitor option fallback space for workstation tier query", async () => {
    expect((await getFallbackProps({ tier: "profi" })).showMonitorOption).toBe(
      true
    );
  });

  test("does not reserve monitor option fallback space by default", async () => {
    expect((await getFallbackProps({})).showMonitorOption).toBe(false);
  });
});
