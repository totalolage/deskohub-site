import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import type { ComponentProps } from "react";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

// React DOM detects input events when it loads, so the DOM must exist first.
registerWorkspaceComponentTestEnv();
const { cleanup, fireEvent, render } = await import(
  "@testing-library/react/pure"
);
const { ReservationSubmitSection } = await import(
  "./reservation-submit-section"
);

const en = { locale: "en-US" } as const;

const renderSection = (
  props: Partial<ComponentProps<typeof ReservationSubmitSection>> = {}
) => {
  const onRetryPrice = mock(() => undefined);
  const view = render(
    <ReservationSubmitSection
      disabled={false}
      isAvailabilityLoading={false}
      isPriceLoading={false}
      locale="en-US"
      onRetryPrice={onRetryPrice}
      priceError={false}
      retryingPrice={false}
      {...props}
    />
  );
  const button = view.container.querySelector("button") as HTMLButtonElement;
  const messages = () =>
    [...view.container.querySelectorAll("p, [role='alert']")].map(
      (element) => ({
        live: element.getAttribute("aria-live"),
        role: element.getAttribute("role"),
        text: element.textContent,
      })
    );

  return { button, messages, onRetryPrice, view };
};

describe("ReservationSubmitSection", () => {
  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("submits the form at either step, so the form routes the step", () => {
    const submit = renderSection();
    expect(submit.button.id).toBe("reservation-submit");
    expect(submit.button.type).toBe("submit");
    cleanup();

    const next = renderSection({ continues: true });
    expect(next.button.id).toBe("reservation-continue");
    expect(next.button.type).toBe("submit");
  });

  test("marks the button with what blocks it", () => {
    const { button } = renderSection({
      disabled: true,
      isAvailabilityLoading: true,
      isPriceLoading: true,
      priceError: true,
      unavailableMessage: "Taken",
    });

    expect(button.disabled).toBe(true);
    expect(button.dataset).toMatchObject({
      reservationAvailabilityLoading: "true",
      reservationPriceError: "true",
      reservationPriceLoading: "true",
      reservationUnavailable: "true",
    });
  });

  test("shows nothing below the button while nothing is pending or wrong", () => {
    const { button, messages } = renderSection();

    expect(messages()).toEqual([]);
    expect(button.dataset).toMatchObject({
      reservationAvailabilityLoading: "false",
      reservationPriceError: "false",
      reservationPriceLoading: "false",
      reservationUnavailable: "false",
    });
  });

  test("announces the unavailable selection and what still loads", () => {
    const { messages } = renderSection({
      isAvailabilityLoading: true,
      isPriceLoading: true,
      unavailableMessage: "Taken",
    });

    expect(messages()).toEqual([
      { live: "polite", role: null, text: "Taken" },
      {
        live: "polite",
        role: null,
        text: m.reservationAvailabilityLoading({}, en),
      },
      {
        live: "polite",
        role: null,
        text: m.reservationAdvertisedPriceLoading({}, en),
      },
    ]);
  });

  test("offers a retry for a failed price", () => {
    const { messages, onRetryPrice, view } = renderSection({
      priceError: true,
    });

    expect(messages()).toEqual([
      {
        live: null,
        role: "alert",
        text: `${m.reservationAdvertisedPriceError({}, en)}${m.reservationAdvertisedPriceRetry({}, en)}`,
      },
    ]);
    const retry = () =>
      view.container.querySelector(
        "#reservation-advertised-price-retry"
      ) as HTMLButtonElement;
    expect(retry().type).toBe("button");
    fireEvent.click(retry());
    expect(onRetryPrice).toHaveBeenCalledTimes(1);

    view.rerender(
      <ReservationSubmitSection
        disabled={false}
        isAvailabilityLoading={false}
        isPriceLoading={false}
        locale="en-US"
        onRetryPrice={onRetryPrice}
        priceError
        retryingPrice
      />
    );
    expect(retry().disabled).toBe(true);
  });

  test("alerts a submission error in place of every other state", () => {
    const { messages } = renderSection({
      isAvailabilityLoading: true,
      isPriceLoading: true,
      priceError: true,
      submissionError: "Payment could not start",
      unavailableMessage: "Taken",
    });

    expect(messages()).toEqual([
      { live: null, role: "alert", text: "Payment could not start" },
    ]);
  });
});
