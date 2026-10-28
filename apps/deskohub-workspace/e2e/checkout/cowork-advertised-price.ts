import { workspaceE2ETimeouts } from "../timeouts";
import type { CheckoutData } from "../types";

/** The cowork selection the reservation form must show with a ready price. */
export type CoworkAdvertisedPriceSelection = {
  readonly date: string;
  readonly monitorOption: string | null;
  readonly tier: string;
  /** How long each in-page wait may take before the preparation fails. */
  readonly waitTimeoutMs: number;
};

export const toCoworkAdvertisedPriceSelection = (
  data: CheckoutData
): CoworkAdvertisedPriceSelection => {
  if (data.expectedReservationDetails.kind !== "cowork") {
    throw new Error("Cowork reservation submission requires cowork data");
  }
  return {
    date: data.date,
    monitorOption: data.expectedReservationDetails.monitorOption ?? null,
    tier: data.expectedReservationDetails.entryTier,
    waitTimeoutMs: workspaceE2ETimeouts.uiTransition,
  };
};

/**
 * Selects the cowork tier, date and monitor option on the reservation form's
 * selection step and waits until the tier's advertised price is ready.
 * A tier changes through its price control; a new date waits for the price
 * to go pending and ready again. Each wait polls every 250 ms and fails with
 * a plain error after `waitTimeoutMs`. Returns the page URL.
 *
 * It runs in the browser, so it must not close over anything; argv callers
 * get it through `getPrepareCoworkAdvertisedPriceScript`.
 */
export const prepareCoworkAdvertisedPrice = async ({
  date: desiredDate,
  monitorOption: desiredMonitorOption,
  tier: desiredTier,
  waitTimeoutMs,
}: CoworkAdvertisedPriceSelection) => {
  const wait = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));
  const waitUntil = async (predicate: () => boolean, label: string) => {
    const deadline = Date.now() + waitTimeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await wait(250);
    }
    if (predicate()) return;
    throw new Error(label);
  };
  const selectTierThroughPrice = async (
    tier: string,
    waitForAdvertisedPrice = true
  ) => {
    const price = document.querySelector(
      `[data-reservation-type-price="${tier}"]`
    );
    const input = document.querySelector(`#reservation-entry-tier-${tier}`);
    if (
      !(price instanceof HTMLElement) ||
      !(input instanceof HTMLInputElement)
    ) {
      throw new Error(`${tier} tier price control not found`);
    }
    price.click();
    await waitUntil(
      () => input.checked,
      `${tier} tier was not selected through its price`
    );
    if (waitForAdvertisedPrice) {
      await waitUntil(
        () => price.dataset.reservationTypePriceReady === "true",
        `${tier} advertised price did not become ready`
      );
    }
  };
  await selectTierThroughPrice(desiredTier, desiredMonitorOption === null);
  const dateInput = document.querySelector('input[name="date"]');
  if (!(dateInput instanceof HTMLInputElement)) {
    throw new Error("cowork reservation date input not found");
  }
  if (dateInput.value !== desiredDate) {
    const price = document.querySelector(
      `[data-reservation-type-price="${desiredTier}"]`
    );
    const dateTrigger = document.querySelector(
      'button[aria-haspopup="dialog"]'
    );
    if (
      !(price instanceof HTMLElement) ||
      !(dateTrigger instanceof HTMLButtonElement)
    ) {
      throw new Error("cowork reservation date controls not found");
    }
    let sawPendingPrice = price.dataset.reservationTypePriceReady === "false";
    const priceObserver = new MutationObserver((records) => {
      if (records.some((record) => record.oldValue === "true")) {
        sawPendingPrice = true;
      }
    });
    priceObserver.observe(price, {
      attributeFilter: ["data-reservation-type-price-ready"],
      attributeOldValue: true,
    });
    try {
      dateTrigger.click();
      const findSelectableDateButton = () => {
        const candidate = document.querySelector(
          `[data-day="${desiredDate}"] button:not(:disabled)`
        );
        return candidate instanceof HTMLButtonElement ? candidate : undefined;
      };
      const visibleCalendarDates = () =>
        [...document.querySelectorAll("[data-day]")]
          .map((day) => day.getAttribute("data-day") ?? "")
          .join("|");
      let dateButton: HTMLButtonElement | undefined;
      for (let month = 0; month < 5; month += 1) {
        let nextMonth: HTMLButtonElement | undefined;
        await waitUntil(() => {
          dateButton = findSelectableDateButton();
          if (dateButton instanceof HTMLButtonElement) return true;
          const candidate = document.querySelector(
            'button[aria-label="Go to the Next Month"]'
          );
          if (candidate instanceof HTMLButtonElement && !candidate.disabled) {
            nextMonth = candidate;
            return true;
          }
          return false;
        }, "cowork reservation date is outside the selectable calendar");
        if (dateButton instanceof HTMLButtonElement) break;

        const previousDates = visibleCalendarDates();
        nextMonth?.click();
        await waitUntil(() => {
          dateButton = findSelectableDateButton();
          const renderedDates = visibleCalendarDates();
          return (
            dateButton instanceof HTMLButtonElement ||
            (renderedDates.length > 0 && renderedDates !== previousDates)
          );
        }, "cowork reservation calendar did not advance");
      }
      if (!(dateButton instanceof HTMLButtonElement)) {
        throw new Error(
          "cowork reservation date was not found in the calendar"
        );
      }
      dateButton.click();
      await waitUntil(
        () => dateInput.value === desiredDate,
        "cowork reservation date did not update"
      );
      await waitUntil(
        () =>
          sawPendingPrice && price.dataset.reservationTypePriceReady === "true",
        "advertised price did not refresh after date selection"
      );
    } finally {
      priceObserver.disconnect();
    }
  }
  if (desiredMonitorOption !== null) {
    const findMonitorInput = () =>
      [...document.querySelectorAll('input[type="radio"]')].find(
        (candidate): candidate is HTMLInputElement =>
          candidate instanceof HTMLInputElement &&
          candidate.value === desiredMonitorOption
      );
    // Monitor options render only once the workstation add-on is on; a date
    // that requires the workstation turns it on by itself.
    if (!findMonitorInput()) {
      const workstationSwitch = document.querySelector(
        '[data-cowork-optional-addon-toggle="workstation"] [role="switch"]'
      );
      if (!(workstationSwitch instanceof HTMLElement)) {
        throw new Error("workstation add-on switch not found");
      }
      if (workstationSwitch.getAttribute("aria-checked") !== "true") {
        workstationSwitch.click();
      }
    }
    let monitorInput: HTMLInputElement | undefined;
    await waitUntil(() => {
      monitorInput = findMonitorInput();
      return monitorInput instanceof HTMLInputElement && !monitorInput.disabled;
    }, `${desiredMonitorOption} monitor option was not available`);
    const price = document.querySelector(
      `[data-reservation-type-price="${desiredTier}"]`
    );
    if (!(price instanceof HTMLElement)) {
      throw new Error(`${desiredTier} advertised price not found`);
    }
    // Advertised prices do not depend on the monitor option, and the page
    // renders both Reserved Desk variants already priced, so the selection
    // only has to land on a ready price.
    const selectedMonitor = monitorInput as HTMLInputElement;
    if (!selectedMonitor.checked) {
      (selectedMonitor.closest("label") ?? selectedMonitor).click();
      await waitUntil(
        () => selectedMonitor.checked,
        `${desiredMonitorOption} monitor option was not selected`
      );
    }
    await waitUntil(
      () => price.dataset.reservationTypePriceReady === "true",
      `${desiredTier} advertised price did not become ready after monitor selection`
    );
  }
  return location.href;
};
