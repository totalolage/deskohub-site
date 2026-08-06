import {
  getMeetingRoomReservationDurationKey,
  isMeetingRoomWholeDayReservationDuration,
} from "@/features/reservation/meeting-room-reservation-duration";
import { workspaceE2ETimeouts } from "./timeouts";
import type { CheckoutData } from "./types";

export const getAssertPrefilledReservationScript = (data: CheckoutData) => {
  if (data.expectedReservationDetails.kind === "meeting-room") {
    return getAssertPrefilledMeetingRoomReservationScript(data);
  }
  if (data.expectedReservationDetails.kind === "office") {
    return getAssertPrefilledOfficeReservationScript(data);
  }

  const expectedReservation = data.expectedReservationDetails;

  return `
(() => {
  const expected = ${JSON.stringify({
    coffee: expectedReservation.coffee,
    date: data.date,
    email: data.email,
    entryTier: expectedReservation.entryTier,
    message: data.message,
    monitorOption: expectedReservation.monitorOption ?? null,
    name: data.name,
    phone: data.phone,
  })};
  const fail = (field) => {
    throw new Error('restored reservation ' + field + ' did not match');
  };
  const value = (selector, field) => {
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) fail(field);
    return element.value;
  };

  const tier = document.querySelector('input[name="entryTier"]:checked');
  if (!(tier instanceof HTMLInputElement) || tier.value !== expected.entryTier) fail('entry tier');

  const dateButton = document.querySelector('button[aria-haspopup="dialog"]');
  if (!(dateButton instanceof HTMLButtonElement)) fail('date');
  const restoredDate = new Intl.DateTimeFormat(${JSON.stringify(data.locale)}, {
    dateStyle: 'full',
    timeZone: 'Europe/Prague',
  }).format(new Date(expected.date + 'T12:00:00Z'));
  if ((dateButton.textContent ?? '').trim() !== restoredDate) fail('date');

  const coffee = document.querySelector('[role="switch"]');
  if (!(coffee instanceof HTMLButtonElement) || coffee.getAttribute('aria-checked') !== String(expected.coffee)) fail('coffee');
  if (value('input[name="email"]', 'email') !== expected.email) fail('email');
  if (value('input[name="phone"]', 'phone') !== expected.phone) fail('phone');
  if (value('input[name="name"]', 'name') !== expected.name) fail('name');
  if (value('textarea[name="message"]', 'message') !== expected.message) fail('message');

  const monitorInputs = [...document.querySelectorAll('input[type="radio"]')]
    .filter((input) => input instanceof HTMLInputElement && input.name !== 'entryTier');
  const selectedMonitor = monitorInputs.find((input) => input.checked);
  if (expected.monitorOption === null) {
    if (monitorInputs.length !== 0) fail('monitor option');
  } else if (!(selectedMonitor instanceof HTMLInputElement) || selectedMonitor.value !== expected.monitorOption) {
    fail('monitor option');
  }

  const consent = document.querySelector('#reservation-privacy-consent');
  if (!(consent instanceof HTMLButtonElement) || consent.getAttribute('aria-checked') !== 'false') fail('privacy consent reset');
  const marketingConsent = document.querySelector('#reservation-marketing-consent');
  if (!(marketingConsent instanceof HTMLButtonElement) || marketingConsent.getAttribute('aria-checked') !== 'false') fail('marketing consent reset');
  return true;
})()
`;
};

const getAssertPrefilledMeetingRoomReservationScript = (data: CheckoutData) => {
  if (!data.meetingRoom) {
    throw new Error("Meeting-room backfill assertions require interval data");
  }

  return `
(() => {
  const expected = ${JSON.stringify({
    date: data.date,
    durationKey: getMeetingRoomReservationDurationKey(
      data.meetingRoom.duration
    ),
    email: data.email,
    message: data.message,
    name: data.name,
    phone: data.phone,
    time: data.meetingRoom.startDateTime.slice(11),
    wholeDay: isMeetingRoomWholeDayReservationDuration(
      data.meetingRoom.duration
    ),
  })};
  const fail = (field) => {
    throw new Error('restored meeting-room ' + field + ' did not match');
  };
  const value = (selector, field) => {
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) fail(field);
    return element.value;
  };

  if (value('input[name="startDateTime"]', 'start date') !== expected.date) fail('start date');
  const time = document.querySelector('input[aria-label="Meeting room start time"]');
  if (expected.wholeDay) {
    if (time !== null) fail('hidden start time');
  } else if (!(time instanceof HTMLInputElement) || time.value !== expected.time) {
    fail('start time');
  }
  const duration = document.querySelector('input[id^="meeting-room-duration-"]:checked');
  if (!(duration instanceof HTMLInputElement) || duration.value !== expected.durationKey) fail('duration');
  if (value('input[name="email"]', 'email') !== expected.email) fail('email');
  if (value('input[name="phone"]', 'phone') !== expected.phone) fail('phone');
  if (value('input[name="name"]', 'name') !== expected.name) fail('name');
  if (value('textarea[name="message"]', 'message') !== expected.message) fail('message');

  const consent = document.querySelector('#reservation-privacy-consent');
  if (!(consent instanceof HTMLButtonElement) || consent.getAttribute('aria-checked') !== 'false') fail('privacy consent reset');
  const marketingConsent = document.querySelector('#reservation-marketing-consent');
  if (!(marketingConsent instanceof HTMLButtonElement) || marketingConsent.getAttribute('aria-checked') !== 'false') fail('marketing consent reset');
  return true;
})()
`;
};

const getAssertPrefilledOfficeReservationScript = (data: CheckoutData) => {
  if (!data.office) {
    throw new Error("Office backfill assertions require range data");
  }

  return `
(() => {
  const expected = ${JSON.stringify({
    additionalGuests: data.office.additionalGuests,
    email: data.email,
    endsOn: data.office.endsOn,
    message: data.message,
    name: data.name,
    phone: data.phone,
    startsOn: data.office.startsOn,
  })};
  const fail = (field) => {
    throw new Error('restored office ' + field + ' did not match');
  };
  const value = (selector, field) => {
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) fail(field);
    return element.value;
  };

  if (value('input[name="startsOn"]', 'start date') !== expected.startsOn) fail('start date');
  if (value('input[name="endsOn"]', 'end date') !== expected.endsOn) fail('end date');
  if (value('input[name="additionalGuests"]', 'other people') !== String(expected.additionalGuests)) fail('other people');
  if (value('input[name="email"]', 'email') !== expected.email) fail('email');
  if (value('input[name="phone"]', 'phone') !== expected.phone) fail('phone');
  if (value('input[name="name"]', 'name') !== expected.name) fail('name');
  if (value('textarea[name="message"]', 'message') !== expected.message) fail('message');

  const consent = document.querySelector('#reservation-privacy-consent');
  if (!(consent instanceof HTMLButtonElement) || consent.getAttribute('aria-checked') !== 'false') fail('privacy consent reset');
  const marketingConsent = document.querySelector('#reservation-marketing-consent');
  if (!(marketingConsent instanceof HTMLButtonElement) || marketingConsent.getAttribute('aria-checked') !== 'false') fail('marketing consent reset');
  return true;
})()
`;
};

export const getPrefilledReservationConditionScript = (data: CheckoutData) => {
  const assertion = getAssertPrefilledReservationScript(data).trim();

  return `
(() => {
  try {
    return (${assertion}) === true;
  } catch {
    return false;
  }
})()
`;
};

export const getSubmitCoworkReservationScript = (data: CheckoutData) => {
  const prepare = getPrepareCoworkAdvertisedPriceScript(data).trim();

  return `
(async () => {
  await (${prepare});
  return await (${submitPreparedCoworkReservationScript.trim()});
})()
`;
};

export const getSubmitMeetingRoomReservationScript = (data: CheckoutData) => {
  const prepare = getPrepareMeetingRoomAdvertisedPriceScript(data).trim();

  return `
(async () => {
  await (${prepare});
  return await (${submitPreparedMeetingRoomReservationScript.trim()});
})()
`;
};

export const getSubmitOfficeReservationScript = (data: CheckoutData) => {
  const prepare = getPrepareOfficeAdvertisedPriceScript(data).trim();

  return `
(async () => {
  await (${prepare});
  return await (${submitPreparedOfficeReservationScript.trim()});
})()
`;
};

export const getPrepareCoworkAdvertisedPriceScript = (data: CheckoutData) => {
  if (data.expectedReservationDetails.kind !== "cowork") {
    throw new Error("Cowork reservation submission requires cowork data");
  }

  const desiredTier = data.expectedReservationDetails.entryTier;
  const desiredMonitorOption =
    data.expectedReservationDetails.monitorOption ?? null;

  return `
(async () => {
  const desiredDate = ${JSON.stringify(data.date)};
  const desiredTier = ${JSON.stringify(desiredTier)};
  const desiredMonitorOption = ${JSON.stringify(desiredMonitorOption)};
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
  const selectTierThroughPrice = async (tier, waitForAdvertisedPrice = true) => {
    const price = document.querySelector('[data-reservation-type-price="' + tier + '"]');
    const input = document.querySelector('#reservation-entry-tier-' + tier);
    if (!(price instanceof HTMLElement) || !(input instanceof HTMLInputElement)) {
      throw new Error(tier + ' tier price control not found');
    }
    price.click();
    await waitUntil(() => input.checked, tier + ' tier was not selected through its price');
    if (waitForAdvertisedPrice) {
      await waitUntil(
        () => price.dataset.reservationTypePriceReady === 'true',
        tier + ' advertised price did not become ready'
      );
    }
  };
  await selectTierThroughPrice(desiredTier, desiredMonitorOption === null);
  const dateInput = document.querySelector('input[name="date"]');
  if (!(dateInput instanceof HTMLInputElement)) {
    throw new Error('cowork reservation date input not found');
  }
  if (dateInput.value !== desiredDate) {
    const price = document.querySelector(
      '[data-reservation-type-price="' + desiredTier + '"]'
    );
    const dateTrigger = document.querySelector('button[aria-haspopup="dialog"]');
    if (!(price instanceof HTMLElement) || !(dateTrigger instanceof HTMLButtonElement)) {
      throw new Error('cowork reservation date controls not found');
    }
    let sawPendingPrice = price.dataset.reservationTypePriceReady === 'false';
    const priceObserver = new MutationObserver((records) => {
      if (records.some((record) => record.oldValue === 'true')) {
        sawPendingPrice = true;
      }
    });
    priceObserver.observe(price, {
      attributeFilter: ['data-reservation-type-price-ready'],
      attributeOldValue: true,
    });
    try {
      dateTrigger.click();
      const findSelectableDateButton = () => {
        const candidate = document.querySelector(
          '[data-day="' + desiredDate + '"] button:not(:disabled)'
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
        }, 'cowork reservation date is outside the selectable calendar');
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
        }, 'cowork reservation calendar did not advance');
      }
      if (!(dateButton instanceof HTMLButtonElement)) {
        throw new Error('cowork reservation date was not found in the calendar');
      }
      dateButton.click();
      await waitUntil(
        () => dateInput.value === desiredDate,
        'cowork reservation date did not update'
      );
      await waitUntil(
        () =>
          sawPendingPrice &&
          price.dataset.reservationTypePriceReady === 'true',
        'advertised price did not refresh after date selection'
      );
    } finally {
      priceObserver.disconnect();
    }
  }
  if (desiredMonitorOption !== null) {
    let monitorInput;
    await waitUntil(() => {
      monitorInput = [...document.querySelectorAll('input[type="radio"]')]
        .find((candidate) =>
          candidate instanceof HTMLInputElement &&
          candidate.value === desiredMonitorOption
        );
      return monitorInput instanceof HTMLInputElement && !monitorInput.disabled;
    }, desiredMonitorOption + ' monitor option was not available');
    const price = document.querySelector(
      '[data-reservation-type-price="' + desiredTier + '"]'
    );
    if (!(price instanceof HTMLElement)) {
      throw new Error(desiredTier + ' advertised price not found');
    }
    if (
      !monitorInput.checked ||
      price.dataset.reservationTypePriceReady !== 'true'
    ) {
      let sawPendingPrice = price.dataset.reservationTypePriceReady === 'false';
      const priceObserver = new MutationObserver((records) => {
        if (records.some((record) => record.oldValue === 'true')) {
          sawPendingPrice = true;
        }
      });
      priceObserver.observe(price, {
        attributeFilter: ['data-reservation-type-price-ready'],
        attributeOldValue: true,
      });
      try {
        (monitorInput.closest('label') ?? monitorInput).click();
        await waitUntil(
          () => monitorInput.checked,
          desiredMonitorOption + ' monitor option was not selected'
        );
        await waitUntil(
          () =>
            sawPendingPrice &&
            price.dataset.reservationTypePriceReady === 'true',
          desiredTier + ' advertised price did not refresh after monitor selection'
        );
      } finally {
        priceObserver.disconnect();
      }
    }
  }
  return location.href;
})()
`;
};

export const getPrepareMeetingRoomAdvertisedPriceScript = (
  data: CheckoutData
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
    message: data.message,
    name: data.name,
    phone: data.phone,
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
    const candidate = document.querySelector('button[aria-label="Meeting room start date"]');
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
  if (!expected.wholeDay) {
    setField('input[aria-label="Meeting room start time"]', expected.time);
  }
  setField('input[name="email"]', expected.email);
  setField('input[name="phone"]', expected.phone);
  setField('input[name="name"]', expected.name);
  setField('textarea[name="message"]', expected.message);

  let priceRetryAttempted = false;
  await waitUntil(() => {
    const hiddenStart = document.querySelector('input[name="startDateTime"]');
    const time = document.querySelector('input[aria-label="Meeting room start time"]');
    const selectedDuration = document.querySelector(
      '[id="meeting-room-duration-' + expected.durationKey + '"]'
    );
    const submit = document.querySelector('button[type="submit"]');
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
    const submit = document.querySelector('button[type="submit"]');
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
    additionalGuests: data.office.additionalGuests,
    email: data.email,
    endsOn: data.office.endsOn,
    message: data.message,
    name: data.name,
    phone: data.phone,
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
      const candidate = document.querySelector('button[aria-label="' + ariaLabel + '"]');
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
      const submit = document.querySelector('button[type="submit"]');
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
          const currentSubmit = document.querySelector('button[type="submit"]');
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

  await selectDate(
    'Office reservation start date',
    'startsOn',
    expected.startsOn,
    'office start date'
  );
  await waitUntil(() => {
    const endsOn = document.querySelector('input[name="endsOn"]');
    return endsOn instanceof HTMLInputElement && endsOn.value === expected.startsOn;
  }, 'office end date did not follow the selected start date');
  await selectDateAfterRequestSettles(
    'Office reservation end date',
    'endsOn',
    expected.endsOn,
    'office end date'
  );
  setField('input[name="additionalGuests"]', String(expected.additionalGuests));
  setField('input[name="email"]', expected.email);
  setField('input[name="phone"]', expected.phone);
  setField('input[name="name"]', expected.name);
  setField('textarea[name="message"]', expected.message);

  let priceRetryAttempted = false;
  await waitUntil(() => {
    const startsOn = document.querySelector('input[name="startsOn"]');
    const endsOn = document.querySelector('input[name="endsOn"]');
    const additionalGuests = document.querySelector('input[name="additionalGuests"]');
    const submit = document.querySelector('button[type="submit"]');
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
      endsOn instanceof HTMLInputElement &&
      endsOn.value === expected.endsOn &&
      additionalGuests instanceof HTMLInputElement &&
      additionalGuests.value === String(expected.additionalGuests) &&
      submit instanceof HTMLButtonElement &&
      !submit.disabled
    );
  }, () => {
    const submit = document.querySelector('button[type="submit"]');
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

const getSubmitPreparedReservationScript = (consentSelector: string) => `
(async () => {
  const consentSelector = ${JSON.stringify(consentSelector)};
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitUntil = async (predicate, label) => {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await wait(250);
    }
    throw new Error(label);
  };
  let checkbox;
  await waitUntil(() => {
    const candidate = document.querySelector(consentSelector);
    if (candidate instanceof HTMLButtonElement) {
      checkbox = candidate;
      return true;
    }
    return false;
  }, 'privacy consent checkbox not found');
  if (checkbox.getAttribute('aria-checked') !== 'true') (checkbox.closest('label') ?? checkbox).click();
  await waitUntil(() => checkbox.getAttribute('aria-checked') === 'true', 'privacy consent checkbox did not check');
  const form = checkbox.closest('form') ?? document.querySelector('form');
  if (!(form instanceof HTMLFormElement)) throw new Error('reservation form not found');
  const button = form.querySelector('button[type="submit"]');
  if (!(button instanceof HTMLButtonElement)) throw new Error('reservation submit button not found');
  await waitUntil(() => !button.disabled, 'reservation submit button stayed disabled');
  return location.href;
})()
`;

export const submitPreparedCoworkReservationScript =
  getSubmitPreparedReservationScript("#reservation-privacy-consent");

export const submitPreparedMeetingRoomReservationScript =
  getSubmitPreparedReservationScript("#reservation-privacy-consent");

export const submitPreparedOfficeReservationScript =
  getSubmitPreparedReservationScript("#reservation-privacy-consent");

export const getSubmitContactFormScript = (data: {
  readonly email: string;
  readonly message: string;
  readonly name: string;
  readonly phone: string;
}) => `
(async () => {
  const data = ${JSON.stringify(data)};
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitUntil = async (predicate, label) => {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await wait(250);
    }
    throw new Error(label);
  };
  const setField = (selector, value) => {
    const field = document.querySelector(selector);
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) {
      throw new Error(selector + ' not found');
    }
    field.focus();
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  };

  await waitUntil(() => document.querySelector('#contact-form form'), 'contact form not found');
  setField('#contact-name', data.name);
  setField('#contact-phone', data.phone);
  setField('#contact-email', data.email);
  setField('#contact-message', data.message);

  const form = document.querySelector('#contact-form form');
  if (!(form instanceof HTMLFormElement)) throw new Error('contact form element missing');
  const button = form.querySelector('button[type="submit"]');
  if (!(button instanceof HTMLButtonElement)) throw new Error('contact submit button missing');
  await waitUntil(() => !button.disabled, 'contact submit button stayed disabled');
  button.click();
  return location.href;
})()
`;

export const getAssertFulfillmentFailedSupportScript = (
  data: CheckoutData,
  orderId: string
) => `
(() => {
  const expected = ${JSON.stringify({ locale: data.locale, orderId })};
  const text = document.body?.textContent ?? '';
  if (!/couldn't deliver your access codes/i.test(text)) {
    throw new Error('fulfillment failed status copy not visible');
  }
  const link = [...document.querySelectorAll('a')].find((candidate) => /Send support request/i.test(candidate.textContent ?? ''));
  if (!(link instanceof HTMLAnchorElement)) {
    throw new Error('support contact link not found');
  }
  const url = new URL(link.href);
  if (url.pathname !== '/' + expected.locale + '/contact') {
    throw new Error('support contact link points at unexpected path');
  }
  if (!(url.searchParams.get('message') ?? '').includes(expected.orderId)) {
    throw new Error('support contact message missing order id');
  }
  return link.href;
})()
`;

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
      for (const key of ['payState', 'checkoutToken', '_vercel_share', 'x-vercel-protection-bypass']) {
        if (url.searchParams.has(key)) url.searchParams.set(key, '[redacted]');
      }
      return url.toString();
    } catch {
      return '[unavailable]';
    }
  };
  const submit = document.querySelector('button[type="submit"]');
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

export const assertFulfilledStatusScript = String.raw`
(() => {
  const text = document.body?.textContent ?? '';
  if (/Your workspace access is ready\./i.test(text) && /sent by email/i.test(text)) {
    return location.href;
  }
  throw new Error('fulfilled checkout status copy not visible');
})()
`;
