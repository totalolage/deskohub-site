import { describe, expect, mock, test } from "bun:test";
import { isValidElement, type ReactNode } from "react";

mock.module("server-only", () => ({}));
mock.module("@/features/reservation/components/reservation-form", () => ({
  ReservationForm: () => null,
  ReservationFormFallback: () => null,
}));

const getRenderedProps = async (
  props: Parameters<
    typeof import("./checkout-order-page").CheckoutOrderPage
  >[0] = { locale: "en-US" }
) => {
  const { CheckoutOrderPage } = await import("./checkout-order-page");
  const page = CheckoutOrderPage(props);

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

  const reservationForm = (suspense.props as { children: ReactNode }).children;

  if (!isValidElement(reservationForm)) {
    throw new Error("CheckoutOrderPage did not render a reservation form");
  }

  return {
    fallback: fallback.props as { readonly showMonitorOption?: boolean },
    reservationForm: reservationForm.props as {
      readonly initialReservation?: unknown;
      readonly checkoutSessionId?: string;
    },
  };
};

describe("CheckoutOrderPage", () => {
  test("uses a static generic reservation fallback", async () => {
    expect((await getRenderedProps()).fallback.showMonitorOption).toBe(false);
  });

  test("passes restored pay state through to the reservation form", async () => {
    const initialReservation = {
      kind: "cowork" as const,
      entryTier: "profi" as const,
      date: "2099-06-10" as never,
      coffee: true as const,
      monitorOption: "2x27-qhd" as const,
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420 777 000 111",
      message: "Please prepare the standing desk.",
    };
    const props = await getRenderedProps({
      initialReservation,
      locale: "en-US",
      checkoutSessionId: "checkout-session-id",
    });

    expect(props.fallback.showMonitorOption).toBe(true);
    expect(props.reservationForm).toEqual({
      initialReservation,
      locale: "en-US",
      checkoutSessionId: "checkout-session-id",
    });
  });
});
