import {
  getMeetingRoomReservationDurationKey,
  isMeetingRoomWholeDayReservationDuration,
} from "@/features/reservation/meeting-room-reservation-duration";
import { workspaceE2ETimeouts } from "../timeouts";
import type { CheckoutData } from "../types";
import { getOfficeDayCount } from "./prefilled-reservation";

/**
 * The product selection the reservation form's selection step must show with
 * a ready advertised price. `waitTimeoutMs` bounds each in-page wait.
 */
export type ReservationSelection =
  | {
      readonly date: string;
      readonly kind: "cowork";
      readonly monitorOption: string | null;
      readonly tier: string;
      readonly waitTimeoutMs: number;
    }
  | {
      readonly date: string;
      readonly durationKey: string;
      readonly kind: "meeting-room";
      readonly startTimeEntry: MeetingRoomStartTimeEntry;
      readonly time: string;
      readonly waitTimeoutMs: number;
      readonly wholeDay: boolean;
    }
  | {
      readonly dayCount: number;
      readonly kind: "office";
      readonly seats: number;
      readonly startsOn: string;
      readonly waitTimeoutMs: number;
    };

/**
 * How an hourly meeting-room start is entered: typed into the time input, or
 * picked from the listed free start times.
 */
type MeetingRoomStartTimeEntry = "listed" | "typed";

export type ReservationSelectionOptions = {
  readonly startTimeEntry?: MeetingRoomStartTimeEntry;
};

type ReservationContact = {
  readonly email: string;
  readonly emailConfirmation: string;
  readonly name: string;
  readonly phone: string;
};

/**
 * What the reservation form preparation does before the runner activates the
 * form's one action button natively. Nothing is submitted.
 *
 * - `step`: on the selection step makes the selection, on the contact step
 *   fills the editable contact inputs; then waits for the enabled action.
 * - `selection`: makes the selection only.
 * - `prepared`: the form is already prepared; waits for the enabled action.
 */
export type ReservationFormPreparation =
  | {
      readonly actionTimeoutMs: number;
      readonly contact: ReservationContact;
      readonly kind: "step";
      readonly selection: ReservationSelection;
    }
  | { readonly kind: "selection"; readonly selection: ReservationSelection }
  | { readonly actionTimeoutMs: number; readonly kind: "prepared" };

// The action button wait the reservation step has always had.
const reservationActionTimeoutMs = 60_000;

export const toReservationSelection = (
  data: CheckoutData,
  { startTimeEntry = "typed" }: ReservationSelectionOptions = {}
): ReservationSelection => {
  const waitTimeoutMs = workspaceE2ETimeouts.uiTransition;
  switch (data.expectedReservationDetails.kind) {
    case "cowork":
      return {
        date: data.date,
        kind: "cowork",
        monitorOption: data.expectedReservationDetails.monitorOption ?? null,
        tier: data.expectedReservationDetails.entryTier,
        waitTimeoutMs,
      };
    case "meeting-room":
      if (!data.meetingRoom) {
        throw new Error(
          "Meeting-room reservation submission requires room data"
        );
      }
      return {
        date: data.date,
        durationKey: getMeetingRoomReservationDurationKey(
          data.meetingRoom.duration
        ),
        kind: "meeting-room",
        startTimeEntry,
        time: data.meetingRoom.startDateTime.slice(11),
        waitTimeoutMs,
        wholeDay: isMeetingRoomWholeDayReservationDuration(
          data.meetingRoom.duration
        ),
      };
    case "office":
      if (!data.office) {
        throw new Error("Office reservation submission requires office data");
      }
      return {
        dayCount: getOfficeDayCount(data.office),
        kind: "office",
        seats: data.office.seats,
        startsOn: data.office.startsOn,
        waitTimeoutMs,
      };
  }
};

/** Selection on the selection step, `data`'s contact on the contact step. */
export const toReservationStep = (
  data: CheckoutData,
  options?: ReservationSelectionOptions
): ReservationFormPreparation => ({
  actionTimeoutMs: reservationActionTimeoutMs,
  contact: {
    email: data.email,
    emailConfirmation: data.email,
    name: data.name,
    phone: data.phone,
  },
  kind: "step",
  selection: toReservationSelection(data, options),
});

export const toReservationSelectionPreparation = (
  data: CheckoutData,
  options?: ReservationSelectionOptions
): ReservationFormPreparation => ({
  kind: "selection",
  selection: toReservationSelection(data, options),
});

/** For a form the case prepared itself: waits for the enabled action. */
export const preparedReservationForm: ReservationFormPreparation = {
  actionTimeoutMs: reservationActionTimeoutMs,
  kind: "prepared",
};

export type ReservationPreparationState =
  | { readonly status: "pending" | "ready" }
  | { readonly error: string; readonly status: "failed" };

/**
 * Runs `preparation` on the reservation form and returns the page URL.
 *
 * With `detachInto` it only starts the preparation: it keeps its state at
 * that global key (`readReservationPreparationState`), records its error
 * message, and returns `true` at once, so a long, UI-backed preparation never
 * rides on one evaluation. Without it the returned promise settles with the
 * preparation.
 *
 * It runs in the browser, so it must not close over anything; every family's
 * body is the template the argv runner ran, verbatim.
 */
export const prepareReservationForm = ({
  detachInto,
  preparation,
}: {
  readonly detachInto?: string;
  readonly preparation: ReservationFormPreparation;
}): Promise<string | true> | true => {
  const wait = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));
  const waitUntil = async (
    predicate: () => boolean,
    label: string | (() => string),
    timeoutMs: number
  ) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await wait(250);
    }
    if (predicate()) return;
    throw new Error(typeof label === "function" ? label() : label);
  };
  const setField = (selector: string, value: string) => {
    const field = document.querySelector(selector);
    if (
      !(
        field instanceof HTMLInputElement ||
        field instanceof HTMLTextAreaElement
      )
    ) {
      throw new Error(`${selector} not found`);
    }
    field.focus();
    const descriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(field),
      "value"
    );
    descriptor?.set?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const visibleCalendarDates = () =>
    [...document.querySelectorAll("[data-day]")]
      .map((day) => day.getAttribute("data-day") ?? "")
      .join("|");
  // The form's one action button: Continue on the selection step, the submit
  // button on the contact step. Both report availability and price loading
  // through the same data attributes.
  const actionSelector = "#reservation-continue, #reservation-submit";
  const describeUnreadyAction = (
    summary: string,
    priceRetryAttempted: boolean
  ) => {
    const submit = document.querySelector(actionSelector);
    const priceRetry = document.querySelector(
      "#reservation-advertised-price-retry"
    );
    const value = (name: string) =>
      submit instanceof HTMLButtonElement
        ? (submit.dataset[name] ?? "unknown")
        : "missing";
    return [
      summary,
      `availability_loading=${value("reservationAvailabilityLoading")}`,
      `price_error=${value("reservationPriceError")}`,
      `price_loading=${value("reservationPriceLoading")}`,
      `unavailable=${value("reservationUnavailable")}`,
      `price_retry_available=${String(
        priceRetry instanceof HTMLButtonElement && !priceRetry.disabled
      )}`,
      `price_retry_attempted=${String(priceRetryAttempted)}`,
    ].join("; ");
  };

  // A tier changes through its price control; a new date waits for the price
  // to go pending and ready again.
  const selectCowork = async ({
    date: desiredDate,
    monitorOption: desiredMonitorOption,
    tier: desiredTier,
    waitTimeoutMs,
  }: Extract<ReservationSelection, { kind: "cowork" }>) => {
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
        `${tier} tier was not selected through its price`,
        waitTimeoutMs
      );
      if (waitForAdvertisedPrice) {
        await waitUntil(
          () => price.dataset.reservationTypePriceReady === "true",
          `${tier} advertised price did not become ready`,
          waitTimeoutMs
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
        let dateButton: HTMLButtonElement | undefined;
        for (let month = 0; month < 5; month += 1) {
          let nextMonth: HTMLButtonElement | undefined;
          await waitUntil(
            () => {
              dateButton = findSelectableDateButton();
              if (dateButton instanceof HTMLButtonElement) return true;
              const candidate = document.querySelector(
                'button[aria-label="Go to the Next Month"]'
              );
              if (
                candidate instanceof HTMLButtonElement &&
                !candidate.disabled
              ) {
                nextMonth = candidate;
                return true;
              }
              return false;
            },
            "cowork reservation date is outside the selectable calendar",
            waitTimeoutMs
          );
          if (dateButton instanceof HTMLButtonElement) break;

          const previousDates = visibleCalendarDates();
          nextMonth?.click();
          await waitUntil(
            () => {
              dateButton = findSelectableDateButton();
              const renderedDates = visibleCalendarDates();
              return (
                dateButton instanceof HTMLButtonElement ||
                (renderedDates.length > 0 && renderedDates !== previousDates)
              );
            },
            "cowork reservation calendar did not advance",
            waitTimeoutMs
          );
        }
        if (!(dateButton instanceof HTMLButtonElement)) {
          throw new Error(
            "cowork reservation date was not found in the calendar"
          );
        }
        dateButton.click();
        await waitUntil(
          () => dateInput.value === desiredDate,
          "cowork reservation date did not update",
          waitTimeoutMs
        );
        await waitUntil(
          () =>
            sawPendingPrice &&
            price.dataset.reservationTypePriceReady === "true",
          "advertised price did not refresh after date selection",
          waitTimeoutMs
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
      // Monitor options render only once the workstation add-on is on; a
      // date that requires the workstation turns it on by itself.
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
      await waitUntil(
        () => {
          monitorInput = findMonitorInput();
          return (
            monitorInput instanceof HTMLInputElement && !monitorInput.disabled
          );
        },
        `${desiredMonitorOption} monitor option was not available`,
        waitTimeoutMs
      );
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
          `${desiredMonitorOption} monitor option was not selected`,
          waitTimeoutMs
        );
      }
      await waitUntil(
        () => price.dataset.reservationTypePriceReady === "true",
        `${desiredTier} advertised price did not become ready after monitor selection`,
        waitTimeoutMs
      );
    }
    return location.href;
  };

  const selectMeetingRoom = async (
    expected: Extract<ReservationSelection, { kind: "meeting-room" }>
  ) => {
    const { waitTimeoutMs } = expected;
    let dateTrigger: HTMLButtonElement | undefined;
    await waitUntil(
      () => {
        const candidate = document.querySelector(
          'button[aria-label^="Meeting room start date"]'
        );
        if (candidate instanceof HTMLButtonElement) {
          dateTrigger = candidate;
          return true;
        }
        return false;
      },
      "meeting-room date control not found",
      waitTimeoutMs
    );
    dateTrigger?.click();

    const findSelectableDateButton = () => {
      const candidate = document.querySelector(
        `[data-day="${expected.date}"] button:not(:disabled)`
      );
      return candidate instanceof HTMLButtonElement ? candidate : undefined;
    };

    let dateButton: HTMLButtonElement | undefined;
    for (let month = 0; month < 5; month += 1) {
      let nextMonth: HTMLButtonElement | undefined;
      await waitUntil(
        () => {
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
        },
        "meeting-room date is outside the selectable calendar",
        waitTimeoutMs
      );
      if (dateButton instanceof HTMLButtonElement) break;

      const previousDates = visibleCalendarDates();
      nextMonth?.click();
      await waitUntil(
        () => {
          dateButton = findSelectableDateButton();
          const renderedDates = visibleCalendarDates();
          return (
            dateButton instanceof HTMLButtonElement ||
            (renderedDates.length > 0 && renderedDates !== previousDates)
          );
        },
        "meeting-room calendar did not advance",
        waitTimeoutMs
      );
    }
    if (!(dateButton instanceof HTMLButtonElement)) {
      throw new Error("meeting-room date was not found in the calendar");
    }
    dateButton.click();
    await waitUntil(
      () => {
        const hiddenStart = document.querySelector(
          'input[name="startDateTime"]'
        );
        return (
          hiddenStart instanceof HTMLInputElement &&
          hiddenStart.value === expected.date
        );
      },
      "meeting-room date did not update",
      waitTimeoutMs
    );

    const duration = document.querySelector(
      `[id="meeting-room-duration-${expected.durationKey}"]`
    );
    if (!(duration instanceof HTMLInputElement)) {
      throw new Error("meeting-room duration control not found");
    }
    if (!duration.checked) (duration.closest("label") ?? duration).click();
    if (!expected.wholeDay && expected.startTimeEntry === "listed") {
      const listedStartSelector = `[role="radiogroup"] input[type="radio"][value="${expected.date}T${expected.time}"]`;
      await waitUntil(
        () =>
          document.querySelector(listedStartSelector) instanceof
          HTMLInputElement,
        () =>
          `meeting-room start ${expected.time} is not among the listed free start times: ${[
            ...document.querySelectorAll<HTMLInputElement>(
              '[role="radiogroup"] input[type="radio"]'
            ),
          ]
            .map((option) => option.value)
            .filter((value) => value.includes("T"))
            .map((value) => value.slice(11))
            .join(",")}`,
        waitTimeoutMs
      );
      const listedStart = document.querySelector(
        listedStartSelector
      ) as HTMLInputElement;
      (listedStart.closest("label") ?? listedStart).click();
    } else if (!expected.wholeDay) {
      setField('input[aria-label^="Meeting room start time"]', expected.time);
    }

    let priceRetryAttempted = false;
    await waitUntil(
      () => {
        const hiddenStart = document.querySelector(
          'input[name="startDateTime"]'
        );
        const time = document.querySelector(
          'input[aria-label^="Meeting room start time"]'
        );
        const selectedDuration = document.querySelector(
          `[id="meeting-room-duration-${expected.durationKey}"]`
        );
        const submit = document.querySelector(actionSelector);
        const priceRetry = document.querySelector(
          "#reservation-advertised-price-retry"
        );
        if (
          !priceRetryAttempted &&
          priceRetry instanceof HTMLButtonElement &&
          !priceRetry.disabled
        ) {
          priceRetryAttempted = true;
          priceRetry.click();
        }
        return (
          hiddenStart instanceof HTMLInputElement &&
          hiddenStart.value === expected.date &&
          (expected.wholeDay
            ? time === null
            : time instanceof HTMLInputElement &&
              time.value === expected.time) &&
          selectedDuration instanceof HTMLInputElement &&
          selectedDuration.checked &&
          submit instanceof HTMLButtonElement &&
          !submit.disabled
        );
      },
      () =>
        describeUnreadyAction(
          "meeting-room availability or advertised price did not become ready",
          priceRetryAttempted
        ),
      waitTimeoutMs
    );
    return location.href;
  };

  const selectOffice = async (
    expected: Extract<ReservationSelection, { kind: "office" }>
  ) => {
    const { waitTimeoutMs } = expected;
    const selectDate = async (
      ariaLabel: string,
      inputName: string,
      desiredDate: string,
      label: string
    ) => {
      const hidden = document.querySelector(`input[name="${inputName}"]`);
      if (!(hidden instanceof HTMLInputElement)) {
        throw new Error(`${label} hidden input not found`);
      }
      if (hidden.value === desiredDate) return;

      let trigger: HTMLButtonElement | undefined;
      await waitUntil(
        () => {
          const candidate = document.querySelector(
            `button[aria-label^="${ariaLabel}"]`
          );
          if (candidate instanceof HTMLButtonElement) {
            trigger = candidate;
            return true;
          }
          return false;
        },
        `${label} control not found`,
        waitTimeoutMs
      );
      trigger?.click();

      const findSelectableDateButton = () => {
        const candidate = document.querySelector(
          `[data-day="${desiredDate}"] button:not(:disabled)`
        );
        return candidate instanceof HTMLButtonElement ? candidate : undefined;
      };
      let dateButton: HTMLButtonElement | undefined;
      for (let month = 0; month < 5; month += 1) {
        let nextMonth: HTMLButtonElement | undefined;
        await waitUntil(
          () => {
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
          },
          `${label} is outside the selectable calendar`,
          waitTimeoutMs
        );
        if (dateButton instanceof HTMLButtonElement) break;

        const previousDates = visibleCalendarDates();
        nextMonth?.click();
        await waitUntil(
          () => {
            dateButton = findSelectableDateButton();
            const renderedDates = visibleCalendarDates();
            return (
              dateButton instanceof HTMLButtonElement ||
              (renderedDates.length > 0 && renderedDates !== previousDates)
            );
          },
          `${label} calendar did not advance`,
          waitTimeoutMs
        );
      }
      if (!(dateButton instanceof HTMLButtonElement)) {
        throw new Error(`${label} was not found in the calendar`);
      }
      dateButton.click();
      await waitUntil(
        () => hidden.value === desiredDate,
        `${label} did not update`,
        waitTimeoutMs
      );
    };
    const selectDateAfterRequestSettles = async (
      ariaLabel: string,
      inputName: string,
      desiredDate: string,
      label: string
    ) => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const submit = document.querySelector(actionSelector);
        if (!(submit instanceof HTMLButtonElement)) {
          throw new Error("office reservation submit control not found");
        }
        let sawPendingRequest =
          submit.dataset.reservationAvailabilityLoading === "true" ||
          submit.dataset.reservationPriceLoading === "true";
        const requestObserver = new MutationObserver((records) => {
          if (
            records.some(
              (record) =>
                record.oldValue === "true" ||
                (record.target instanceof HTMLButtonElement &&
                  (record.target.dataset.reservationAvailabilityLoading ===
                    "true" ||
                    record.target.dataset.reservationPriceLoading === "true"))
            )
          ) {
            sawPendingRequest = true;
          }
        });
        requestObserver.observe(submit, {
          attributeFilter: [
            "data-reservation-availability-loading",
            "data-reservation-price-loading",
          ],
          attributeOldValue: true,
        });

        let dateRegressed = false;
        try {
          await selectDate(ariaLabel, inputName, desiredDate, label);
          await waitUntil(
            () => {
              const hidden = document.querySelector(
                `input[name="${inputName}"]`
              );
              const currentSubmit = document.querySelector(actionSelector);
              if (!(hidden instanceof HTMLInputElement)) return false;
              if (hidden.value !== desiredDate) {
                dateRegressed = true;
                return true;
              }
              if (!(currentSubmit instanceof HTMLButtonElement)) return false;
              const requestPending =
                currentSubmit.dataset.reservationAvailabilityLoading ===
                  "true" ||
                currentSubmit.dataset.reservationPriceLoading === "true";
              if (requestPending) sawPendingRequest = true;
              return sawPendingRequest && !requestPending;
            },
            `${label} request did not settle`,
            waitTimeoutMs
          );
        } finally {
          requestObserver.disconnect();
        }

        if (!dateRegressed) return;
      }

      throw new Error(`${label} did not remain selected`);
    };

    await selectDateAfterRequestSettles(
      "Office reservation start date",
      "startsOn",
      expected.startsOn,
      "office start date"
    );
    setField('input[name="dayCount"]', String(expected.dayCount));
    const seatsOption = document.querySelector(
      `input[name="seats"][value="${expected.seats}"]`
    );
    if (!(seatsOption instanceof HTMLInputElement)) {
      throw new Error("office seat option not found");
    }
    seatsOption.click();

    let priceRetryAttempted = false;
    await waitUntil(
      () => {
        const startsOn = document.querySelector('input[name="startsOn"]');
        const dayCount = document.querySelector('input[name="dayCount"]');
        const seats = document.querySelector('input[name="seats"]:checked');
        const submit = document.querySelector(actionSelector);
        const priceRetry = document.querySelector(
          "#reservation-advertised-price-retry"
        );
        if (
          !priceRetryAttempted &&
          priceRetry instanceof HTMLButtonElement &&
          !priceRetry.disabled
        ) {
          priceRetryAttempted = true;
          priceRetry.click();
        }
        return (
          startsOn instanceof HTMLInputElement &&
          startsOn.value === expected.startsOn &&
          dayCount instanceof HTMLInputElement &&
          dayCount.value === String(expected.dayCount) &&
          seats instanceof HTMLInputElement &&
          seats.value === String(expected.seats) &&
          submit instanceof HTMLButtonElement &&
          !submit.disabled
        );
      },
      () =>
        describeUnreadyAction(
          "office availability or advertised price did not become ready",
          priceRetryAttempted
        ),
      waitTimeoutMs
    );
    return location.href;
  };

  const select = (selection: ReservationSelection) => {
    switch (selection.kind) {
      case "cowork":
        return selectCowork(selection);
      case "meeting-room":
        return selectMeetingRoom(selection);
      case "office":
        return selectOffice(selection);
    }
  };

  // Booking as a linked account renders no contact inputs, and a
  // profile-missing account's email is read-only, so only rendered, editable
  // inputs are filled; booking for someone else also repeats the email.
  const fillContact = async (contact: ReservationContact) => {
    const form = document.querySelector("#reservation-submit")?.closest("form");
    if (!(form instanceof HTMLFormElement)) {
      throw new Error("reservation contact step is not shown");
    }
    for (const [name, value] of Object.entries(contact)) {
      const field = form.querySelector(`input[name="${name}"]`);
      if (!(field instanceof HTMLInputElement) || field.readOnly) continue;
      if (field.closest("[hidden]") !== null) {
        throw new Error("reservation contact step is not shown");
      }
      if (field.value === value) continue;
      field.focus();
      const descriptor = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(field),
        "value"
      );
      descriptor?.set?.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      field.blur();
    }
    return location.href;
  };

  // Unlike the selection waits, the action wait never checks once more after
  // its deadline.
  const waitForEnabledAction = async (timeoutMs: number) => {
    const waitForAction = async (predicate: () => boolean, label: string) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (predicate()) return;
        await wait(250);
      }
      throw new Error(label);
    };
    let button: HTMLButtonElement | undefined;
    await waitForAction(() => {
      const candidate = document.querySelector(actionSelector);
      if (candidate instanceof HTMLButtonElement) {
        button = candidate;
        return true;
      }
      return false;
    }, "reservation continue or submit button not found");
    const action = button as HTMLButtonElement;
    const form = action.closest("form") ?? document.querySelector("form");
    if (!(form instanceof HTMLFormElement)) {
      throw new Error("reservation form not found");
    }
    await waitForAction(
      () => !action.disabled,
      `reservation ${action.id} button stayed disabled`
    );
    return location.href;
  };

  const prepare = async () => {
    switch (preparation.kind) {
      case "selection":
        return select(preparation.selection);
      case "step":
        if (document.querySelector("#reservation-continue") !== null) {
          await select(preparation.selection);
        } else {
          await fillContact(preparation.contact);
        }
        return waitForEnabledAction(preparation.actionTimeoutMs);
      case "prepared":
        return waitForEnabledAction(preparation.actionTimeoutMs);
    }
  };

  if (detachInto === undefined) return prepare();

  const state: { error?: string; status: "failed" | "pending" | "ready" } = {
    status: "pending",
  };
  Reflect.set(globalThis, detachInto, state);
  Promise.resolve()
    .then(prepare)
    .then(
      () => {
        state.status = "ready";
      },
      (error: unknown) => {
        state.status = "failed";
        state.error = String(
          error instanceof Error ? error.message : error
        ).slice(0, 500);
      }
    );
  return true;
};

/**
 * The state `prepareReservationForm` keeps at `key`; pending until it
 * started. Runs in the browser.
 */
export const readReservationPreparationState = (key: string): unknown =>
  Reflect.get(globalThis, key) ?? { status: "pending" };
