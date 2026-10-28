import {
  getMeetingRoomReservationDurationKey,
  isMeetingRoomWholeDayReservationDuration,
} from "@/features/reservation/meeting-room-reservation-duration";
import {
  prepareCoworkAdvertisedPrice,
  toCoworkAdvertisedPriceSelection,
} from "./checkout/cowork-advertised-price";
import {
  getOfficeDayCount,
  isPrefilledReservation,
  type PrefilledReservationOptions,
  toPrefilledReservation,
} from "./checkout/prefilled-reservation";
import { workspaceE2ETimeouts } from "./timeouts";
import type { CheckoutData } from "./types";

/**
 * A self-contained in-page function called with its JSON argument, as the
 * expression the argv `wait --fn` and `eval` commands evaluate. It lets an
 * argv caller run the same function a session helper passes to Playwright.
 */
export const inPageCall = <Arg>(fn: (arg: Arg) => unknown, arg: Arg) =>
  `(${fn.toString()})(${JSON.stringify(arg)})`;

// The reservation form's one action button: Continue on the selection step,
// the submit button on the contact step. Both report availability and price
// loading through the same data attributes.
const reservationActionSelector = "#reservation-continue, #reservation-submit";
const reservationActionSelectorLiteral = JSON.stringify(
  reservationActionSelector
);

/**
 * The argv condition over `isPrefilledReservation`, for callers still on the
 * argv runner.
 */
export const getPrefilledReservationConditionScript = (
  data: CheckoutData,
  options: PrefilledReservationOptions = {}
) => inPageCall(isPrefilledReservation, toPrefilledReservation(data, options));

/**
 * Prepares one step of the reservation form for its native activation. On the
 * selection step it makes `prepare`'s selection and waits for Continue; on the
 * contact step it fills `data`'s contact and waits for the submit button. The
 * runner activates each button natively and runs the script again after
 * Continue.
 */
const getReservationStepScript = (prepare: string, data: CheckoutData) => `
(async () => {
  if (document.querySelector('#reservation-continue') !== null) {
    await (${prepare.trim()});
  } else {
    await (${getFillReservationContactScript(data).trim()});
  }
  return await (${getSubmitPreparedReservationScript().trim()});
})()
`;

export const getSubmitCoworkReservationScript = (data: CheckoutData) =>
  getReservationStepScript(getPrepareCoworkAdvertisedPriceScript(data), data);

export const getSubmitMeetingRoomReservationScript = (
  data: CheckoutData,
  options?: MeetingRoomStartTimeEntryOptions
) =>
  getReservationStepScript(
    getPrepareMeetingRoomAdvertisedPriceScript(data, options),
    data
  );

export const getSubmitOfficeReservationScript = (data: CheckoutData) =>
  getReservationStepScript(getPrepareOfficeAdvertisedPriceScript(data), data);

/**
 * Fills the contact step's editable inputs with `data`'s contact. Booking as
 * a linked account renders no contact inputs, and a profile-missing account's
 * email is read-only, so only rendered, editable inputs are filled; booking
 * for someone else also repeats the email.
 */
export const getFillReservationContactScript = (data: CheckoutData) => `
(async () => {
  const contact = ${JSON.stringify({
    email: data.email,
    emailConfirmation: data.email,
    name: data.name,
    phone: data.phone,
  })};
  const form = document.querySelector('#reservation-submit')?.closest('form');
  if (!(form instanceof HTMLFormElement)) {
    throw new Error('reservation contact step is not shown');
  }
  for (const [name, value] of Object.entries(contact)) {
    const field = form.querySelector('input[name="' + name + '"]');
    if (!(field instanceof HTMLInputElement) || field.readOnly) continue;
    if (field.closest('[hidden]') !== null) {
      throw new Error('reservation contact step is not shown');
    }
    if (field.value === value) continue;
    field.focus();
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value');
    descriptor?.set?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    field.blur();
  }
  return location.href;
})()
`;

/**
 * The argv form of `prepareCoworkAdvertisedPrice`, which the reservation
 * preparation in `checkout/payment.ts` runs.
 */
export const getPrepareCoworkAdvertisedPriceScript = (data: CheckoutData) =>
  inPageCall(
    prepareCoworkAdvertisedPrice,
    toCoworkAdvertisedPriceSelection(data)
  );

type MeetingRoomStartTimeEntryOptions = {
  /**
   * How an hourly start is entered: typed into the time input, or picked from
   * the listed free start times.
   */
  readonly startTimeEntry?: "listed" | "typed";
};

export const getPrepareMeetingRoomAdvertisedPriceScript = (
  data: CheckoutData,
  { startTimeEntry = "typed" }: MeetingRoomStartTimeEntryOptions = {}
) => {
  if (
    data.expectedReservationDetails.kind !== "meeting-room" ||
    !data.meetingRoom
  ) {
    throw new Error("Meeting-room reservation submission requires room data");
  }

  return `
(async () => {
  const expected = ${JSON.stringify({
    date: data.date,
    durationKey: getMeetingRoomReservationDurationKey(
      data.meetingRoom.duration
    ),
    email: data.email,
    name: data.name,
    phone: data.phone,
    startTimeEntry,
    time: data.meetingRoom.startDateTime.slice(11),
    wholeDay: isMeetingRoomWholeDayReservationDuration(
      data.meetingRoom.duration
    ),
  })};
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitUntil = async (predicate, label) => {
    const deadline = Date.now() + ${workspaceE2ETimeouts.uiTransition};
    while (Date.now() < deadline) {
      if (predicate()) return;
      await wait(250);
    }
    if (predicate()) return;
    throw new Error(typeof label === 'function' ? label() : label);
  };
  const setField = (selector, value) => {
    const field = document.querySelector(selector);
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) {
      throw new Error(selector + ' not found');
    }
    field.focus();
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value');
    descriptor?.set?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  };

  let dateTrigger;
  await waitUntil(() => {
    const candidate = document.querySelector('button[aria-label^="Meeting room start date"]');
    if (candidate instanceof HTMLButtonElement) {
      dateTrigger = candidate;
      return true;
    }
    return false;
  }, 'meeting-room date control not found');
  dateTrigger.click();

  const findSelectableDateButton = () => {
    const candidate = document.querySelector(
      '[data-day="' + expected.date + '"] button:not(:disabled)'
    );
    return candidate instanceof HTMLButtonElement ? candidate : undefined;
  };
  const visibleCalendarDates = () =>
    [...document.querySelectorAll('[data-day]')]
      .map((day) => day.getAttribute('data-day') ?? '')
      .join('|');

  let dateButton;
  for (let month = 0; month < 5; month += 1) {
    let nextMonth;
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
    }, 'meeting-room date is outside the selectable calendar');
    if (dateButton instanceof HTMLButtonElement) break;

    const previousDates = visibleCalendarDates();
    nextMonth.click();
    await waitUntil(() => {
      dateButton = findSelectableDateButton();
      const renderedDates = visibleCalendarDates();
      return (
        dateButton instanceof HTMLButtonElement ||
        (renderedDates.length > 0 && renderedDates !== previousDates)
      );
    }, 'meeting-room calendar did not advance');
  }
  if (!(dateButton instanceof HTMLButtonElement)) {
    throw new Error('meeting-room date was not found in the calendar');
  }
  dateButton.click();
  await waitUntil(() => {
    const hiddenStart = document.querySelector('input[name="startDateTime"]');
    return (
      hiddenStart instanceof HTMLInputElement &&
      hiddenStart.value === expected.date
    );
  }, 'meeting-room date did not update');

  const duration = document.querySelector('[id="meeting-room-duration-' + expected.durationKey + '"]');
  if (!(duration instanceof HTMLInputElement)) {
    throw new Error('meeting-room duration control not found');
  }
  if (!duration.checked) (duration.closest('label') ?? duration).click();
  if (!expected.wholeDay && expected.startTimeEntry === 'listed') {
    const listedStartSelector =
      '[role="radiogroup"] input[type="radio"][value="' +
      expected.date + 'T' + expected.time + '"]';
    await waitUntil(
      () => document.querySelector(listedStartSelector) instanceof HTMLInputElement,
      () =>
        'meeting-room start ' + expected.time +
        ' is not among the listed free start times: ' +
        [...document.querySelectorAll('[role="radiogroup"] input[type="radio"]')]
          .map((option) => option.value)
          .filter((value) => value.includes('T'))
          .map((value) => value.slice(11))
          .join(',')
    );
    const listedStart = document.querySelector(listedStartSelector);
    (listedStart.closest('label') ?? listedStart).click();
  } else if (!expected.wholeDay) {
    setField('input[aria-label^="Meeting room start time"]', expected.time);
  }

  let priceRetryAttempted = false;
  await waitUntil(() => {
    const hiddenStart = document.querySelector('input[name="startDateTime"]');
    const time = document.querySelector('input[aria-label^="Meeting room start time"]');
    const selectedDuration = document.querySelector(
      '[id="meeting-room-duration-' + expected.durationKey + '"]'
    );
    const submit = document.querySelector(${reservationActionSelectorLiteral});
    const priceRetry = document.querySelector('#reservation-advertised-price-retry');
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
        : time instanceof HTMLInputElement && time.value === expected.time) &&
      selectedDuration instanceof HTMLInputElement &&
      selectedDuration.checked &&
      submit instanceof HTMLButtonElement &&
      !submit.disabled
    );
  }, () => {
    const submit = document.querySelector(${reservationActionSelectorLiteral});
    const priceRetry = document.querySelector('#reservation-advertised-price-retry');
    const value = (name) =>
      submit instanceof HTMLButtonElement ? submit.dataset[name] ?? 'unknown' : 'missing';
    return [
      'meeting-room availability or advertised price did not become ready',
      'availability_loading=' + value('reservationAvailabilityLoading'),
      'price_error=' + value('reservationPriceError'),
      'price_loading=' + value('reservationPriceLoading'),
      'unavailable=' + value('reservationUnavailable'),
      'price_retry_available=' + String(
        priceRetry instanceof HTMLButtonElement && !priceRetry.disabled
      ),
      'price_retry_attempted=' + String(priceRetryAttempted),
    ].join('; ');
  });
  return location.href;
})()
`;
};

export const getPrepareOfficeAdvertisedPriceScript = (data: CheckoutData) => {
  if (data.expectedReservationDetails.kind !== "office" || !data.office) {
    throw new Error("Office reservation submission requires office data");
  }

  return `
(async () => {
  const expected = ${JSON.stringify({
    email: data.email,
    dayCount: getOfficeDayCount(data.office),
    name: data.name,
    phone: data.phone,
    seats: data.office.seats,
    startsOn: data.office.startsOn,
  })};
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitUntil = async (predicate, label) => {
    const deadline = Date.now() + ${workspaceE2ETimeouts.uiTransition};
    while (Date.now() < deadline) {
      if (predicate()) return;
      await wait(250);
    }
    if (predicate()) return;
    throw new Error(typeof label === 'function' ? label() : label);
  };
  const setField = (selector, value) => {
    const field = document.querySelector(selector);
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) {
      throw new Error(selector + ' not found');
    }
    field.focus();
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value');
    descriptor?.set?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const visibleCalendarDates = () =>
    [...document.querySelectorAll('[data-day]')]
      .map((day) => day.getAttribute('data-day') ?? '')
      .join('|');
  const selectDate = async (ariaLabel, inputName, desiredDate, label) => {
    const hidden = document.querySelector('input[name="' + inputName + '"]');
    if (!(hidden instanceof HTMLInputElement)) {
      throw new Error(label + ' hidden input not found');
    }
    if (hidden.value === desiredDate) return;

    let trigger;
    await waitUntil(() => {
      const candidate = document.querySelector('button[aria-label^="' + ariaLabel + '"]');
      if (candidate instanceof HTMLButtonElement) {
        trigger = candidate;
        return true;
      }
      return false;
    }, label + ' control not found');
    trigger.click();

    const findSelectableDateButton = () => {
      const candidate = document.querySelector(
        '[data-day="' + desiredDate + '"] button:not(:disabled)'
      );
      return candidate instanceof HTMLButtonElement ? candidate : undefined;
    };
    let dateButton;
    for (let month = 0; month < 5; month += 1) {
      let nextMonth;
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
      }, label + ' is outside the selectable calendar');
      if (dateButton instanceof HTMLButtonElement) break;

      const previousDates = visibleCalendarDates();
      nextMonth.click();
      await waitUntil(() => {
        dateButton = findSelectableDateButton();
        const renderedDates = visibleCalendarDates();
        return (
          dateButton instanceof HTMLButtonElement ||
          (renderedDates.length > 0 && renderedDates !== previousDates)
        );
      }, label + ' calendar did not advance');
    }
    if (!(dateButton instanceof HTMLButtonElement)) {
      throw new Error(label + ' was not found in the calendar');
    }
    dateButton.click();
    await waitUntil(() => hidden.value === desiredDate, label + ' did not update');
  };
  const selectDateAfterRequestSettles = async (
    ariaLabel,
    inputName,
    desiredDate,
    label
  ) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const submit = document.querySelector(${reservationActionSelectorLiteral});
      if (!(submit instanceof HTMLButtonElement)) {
        throw new Error('office reservation submit control not found');
      }
      let sawPendingRequest =
        submit.dataset.reservationAvailabilityLoading === 'true' ||
        submit.dataset.reservationPriceLoading === 'true';
      const requestObserver = new MutationObserver((records) => {
        if (
          records.some(
            (record) =>
              record.oldValue === 'true' ||
              (record.target instanceof HTMLButtonElement &&
                (record.target.dataset.reservationAvailabilityLoading === 'true' ||
                  record.target.dataset.reservationPriceLoading === 'true'))
          )
        ) {
          sawPendingRequest = true;
        }
      });
      requestObserver.observe(submit, {
        attributeFilter: [
          'data-reservation-availability-loading',
          'data-reservation-price-loading',
        ],
        attributeOldValue: true,
      });

      let dateRegressed = false;
      try {
        await selectDate(ariaLabel, inputName, desiredDate, label);
        await waitUntil(() => {
          const hidden = document.querySelector('input[name="' + inputName + '"]');
          const currentSubmit = document.querySelector(${reservationActionSelectorLiteral});
          if (!(hidden instanceof HTMLInputElement)) return false;
          if (hidden.value !== desiredDate) {
            dateRegressed = true;
            return true;
          }
          if (!(currentSubmit instanceof HTMLButtonElement)) return false;
          const requestPending =
            currentSubmit.dataset.reservationAvailabilityLoading === 'true' ||
            currentSubmit.dataset.reservationPriceLoading === 'true';
          if (requestPending) sawPendingRequest = true;
          return sawPendingRequest && !requestPending;
        }, label + ' request did not settle');
      } finally {
        requestObserver.disconnect();
      }

      if (!dateRegressed) return;
    }

    throw new Error(label + ' did not remain selected');
  };

  await selectDateAfterRequestSettles(
    'Office reservation start date',
    'startsOn',
    expected.startsOn,
    'office start date'
  );
  setField('input[name="dayCount"]', String(expected.dayCount));
  const seatsOption = document.querySelector(
    'input[name="seats"][value="' + expected.seats + '"]'
  );
  if (!(seatsOption instanceof HTMLInputElement)) {
    throw new Error('office seat option not found');
  }
  seatsOption.click();

  let priceRetryAttempted = false;
  await waitUntil(() => {
    const startsOn = document.querySelector('input[name="startsOn"]');
    const dayCount = document.querySelector('input[name="dayCount"]');
    const seats = document.querySelector('input[name="seats"]:checked');
    const submit = document.querySelector(${reservationActionSelectorLiteral});
    const priceRetry = document.querySelector('#reservation-advertised-price-retry');
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
  }, () => {
    const submit = document.querySelector(${reservationActionSelectorLiteral});
    const priceRetry = document.querySelector('#reservation-advertised-price-retry');
    const value = (name) =>
      submit instanceof HTMLButtonElement ? submit.dataset[name] ?? 'unknown' : 'missing';
    return [
      'office availability or advertised price did not become ready',
      'availability_loading=' + value('reservationAvailabilityLoading'),
      'price_error=' + value('reservationPriceError'),
      'price_loading=' + value('reservationPriceLoading'),
      'unavailable=' + value('reservationUnavailable'),
      'price_retry_available=' + String(
        priceRetry instanceof HTMLButtonElement && !priceRetry.disabled
      ),
      'price_retry_attempted=' + String(priceRetryAttempted),
    ].join('; ');
  });
  return location.href;
})()
`;
};

const getSubmitPreparedReservationScript = () => `
(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitUntil = async (predicate, label) => {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await wait(250);
    }
    throw new Error(label);
  };
  let button;
  await waitUntil(() => {
    const candidate = document.querySelector(${reservationActionSelectorLiteral});
    if (candidate instanceof HTMLButtonElement) {
      button = candidate;
      return true;
    }
    return false;
  }, 'reservation continue or submit button not found');
  const form = button.closest('form') ?? document.querySelector('form');
  if (!(form instanceof HTMLFormElement)) throw new Error('reservation form not found');
  await waitUntil(() => !button.disabled, 'reservation ' + button.id + ' button stayed disabled');
  return location.href;
})()
`;

export const submitPreparedCoworkReservationScript =
  getSubmitPreparedReservationScript();

export const submitPreparedMeetingRoomReservationScript =
  getSubmitPreparedReservationScript();

export const submitPreparedOfficeReservationScript =
  getSubmitPreparedReservationScript();

export const payPageOrderIdScript = `
(() => {
  const idPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const match = (document.body?.innerText ?? '').match(idPattern);
  return match?.[0] ?? '';
})()
`;

export const browserDiagnosticsScript = String.raw`
(() => {
  const cleanUrl = (value) => {
    try {
      const url = new URL(value);
      for (const key of ['payState', 'contact', 'checkoutToken', 'accessToken', '_vercel_share', 'x-vercel-protection-bypass']) {
        if (url.searchParams.has(key)) url.searchParams.set(key, '[redacted]');
      }
      return url.toString();
    } catch {
      return '[unavailable]';
    }
  };
  const submit = document.querySelector(${reservationActionSelectorLiteral});
  const alerts = [...document.querySelectorAll('[role="alert"]')]
    .map((element) => element.textContent?.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return {
    alerts,
    body: (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 1200),
    submitDisabled: submit instanceof HTMLButtonElement ? submit.disabled : null,
    submitText: submit?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    title: document.title,
    url: cleanUrl(location.href),
  };
})()
`;

export const browserTextScript = `
(() => document.body?.innerText ?? '')()
`;
