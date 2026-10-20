import { type Locale, m } from "@/features/i18n";
import {
  getMeetingRoomReservationDurationKey,
  isMeetingRoomWholeDayReservationDuration,
} from "@/features/reservation/meeting-room-reservation-duration";
import { workspaceE2ETimeouts } from "./timeouts";
import type { CheckoutData, CheckoutRow } from "./types";

// The reservation form's one action button: Continue on the selection step,
// the submit button on the contact step. Both report availability and price
// loading through the same data attributes.
const reservationActionSelector = "#reservation-continue, #reservation-submit";
const reservationActionSelectorLiteral = JSON.stringify(
  reservationActionSelector
);

// The real cowork form renders the coffee switch only for Open Space and the
// workstation (monitor) switch only for Reserved Desk. Both are FormControl
// switches whose accessible name comes from aria-labelledby pointing at their
// FormLabel (shared/components/ui/form.tsx), so assertions match by that
// localized label text.
const getCoworkSwitchExpectations = (entryTier: string, locale: Locale) => ({
  coffeeSwitchLabel:
    entryTier === "open-space"
      ? m.reservationCoffeeLabel({}, { locale })
      : null,
  workstationSwitchLabel:
    entryTier === "reserved-desk"
      ? m.reservationWorkstationLabel({}, { locale })
      : null,
});

const getCoworkSwitchSelectionScript = () => `
  const switchAccessibleName = (element) => {
    const labelledby = element.getAttribute('aria-labelledby');
    if (typeof labelledby === 'string' && labelledby.length > 0) {
      const labelText = labelledby
        .split(/\\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
        .replace(/\\s+/g, ' ')
        .trim();
      if (labelText.length > 0) return labelText;
    }
    return (element.textContent ?? '').replace(/\\s+/g, ' ').trim();
  };
  const findSwitchByLabel = (label) =>
    [...document.querySelectorAll('[role="switch"]')].find(
      (candidate) =>
        candidate instanceof HTMLButtonElement &&
        switchAccessibleName(candidate).includes(label)
    );
`;

type PrefilledReservationOptions = {
  readonly includeContact?: boolean;
};

const getOfficeDayCount = (office: NonNullable<CheckoutData["office"]>) =>
  Temporal.PlainDate.from(office.startsOn).until(
    Temporal.PlainDate.from(office.endsOn),
    { largestUnit: "day" }
  ).days + 1;

export const getAssertRepeatReservationScript = (data: CheckoutData) => {
  const expected = (() => {
    if (data.expectedReservationDetails.kind === "cowork") {
      const { coffee, entryTier, monitorOption } =
        data.expectedReservationDetails;
      return {
        coffee,
        ...getCoworkSwitchExpectations(entryTier, data.locale),
        entryTier,
        kind: "cowork",
        monitorOption: monitorOption ?? null,
        oldDate: data.date,
        query: [
          ["entryTier", entryTier],
          ["coffee", String(coffee)],
          ...(monitorOption ? [["monitorOption", monitorOption]] : []),
        ],
      } as const;
    }
    if (data.expectedReservationDetails.kind === "office") {
      if (!data.office) {
        throw new Error("Office repeat assertions require range data");
      }
      return {
        dayCount: getOfficeDayCount(data.office),
        kind: "office",
        oldDate: data.office.startsOn,
        query: [
          ["dayCount", String(getOfficeDayCount(data.office))],
          ["seats", String(data.office.seats)],
        ],
        seats: data.office.seats,
      } as const;
    }
    return {
      kind: "meeting-room",
      oldDate: data.date,
      query: [],
    } as const;
  })();

  return `
(() => {
  const expected = ${JSON.stringify(expected)};
  ${getCoworkSwitchSelectionScript()}
  const fail = (field) => {
    throw new Error('repeat reservation ' + field + ' did not match');
  };
  const value = (selector, field) => {
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) fail(field);
    return element.value;
  };

  const query = [...new URLSearchParams(location.search).entries()];
  if (JSON.stringify(query) !== JSON.stringify(expected.query)) fail('query allowlist');
  // A signed-in account books as itself by default, so its contact inputs
  // may be absent; any rendered input must start empty.
  const contactValue = (name) => {
    const element = document.querySelector('input[name="' + name + '"]');
    return element instanceof HTMLInputElement ? element.value : '';
  };
  if (contactValue('email') !== '') fail('email reset');
  if (contactValue('phone') !== '') fail('phone reset');
  if (contactValue('name') !== '') fail('name reset');

  if (expected.kind === 'cowork') {
    if (value('input[name="date"]', 'date') === expected.oldDate) fail('fresh date');
    const tier = document.querySelector('input[name="entryTier"]:checked');
    if (!(tier instanceof HTMLInputElement) || tier.value !== expected.entryTier) fail('entry tier');
    const coffee = expected.coffeeSwitchLabel
      ? findSwitchByLabel(expected.coffeeSwitchLabel)
      : undefined;
    if (expected.coffeeSwitchLabel) {
      if (
        !(coffee instanceof HTMLButtonElement) ||
        coffee.getAttribute('aria-checked') !== String(expected.coffee)
      ) {
        fail('coffee switch');
      }
    }
    const workstation = expected.workstationSwitchLabel
      ? findSwitchByLabel(expected.workstationSwitchLabel)
      : undefined;
    if (expected.workstationSwitchLabel) {
      if (
        !(workstation instanceof HTMLButtonElement) ||
        workstation.getAttribute('aria-checked') !==
          String(expected.monitorOption !== null)
      ) {
        fail('workstation switch');
      }
    }
    const monitor = document.querySelector('input[name="monitorOption"]:checked');
    if (expected.monitorOption === null ? monitor !== null : !(monitor instanceof HTMLInputElement) || monitor.value !== expected.monitorOption) fail('monitor option');
  } else if (expected.kind === 'office') {
    if (value('input[name="startsOn"]', 'start date') === expected.oldDate) fail('fresh start date');
    if (value('input[name="dayCount"]', 'day count') !== String(expected.dayCount)) fail('day count');
    const seats = document.querySelector('input[name="seats"]:checked');
    if (!(seats instanceof HTMLInputElement) || seats.value !== String(expected.seats)) fail('seats');
  } else if (value('input[name="startDateTime"]', 'start date') === expected.oldDate) {
    fail('fresh meeting-room date');
  }

  // The consent renders only for someone booking as themselves.
  const marketingConsent = document.querySelector('#reservation-marketing-consent');
  if (marketingConsent !== null && (!(marketingConsent instanceof HTMLButtonElement) || marketingConsent.getAttribute('aria-checked') !== 'false')) fail('marketing consent reset');
  return true;
})()
`;
};

/**
 * Asserts the reservation form shows `data`'s selection and, unless
 * `includeContact` is false, its contact with marketing consent reset.
 */
export const getAssertPrefilledReservationScript = (
  data: CheckoutData,
  { includeContact = true }: PrefilledReservationOptions = {}
) => {
  if (data.expectedReservationDetails.kind === "meeting-room") {
    return getAssertPrefilledMeetingRoomReservationScript(data, includeContact);
  }
  if (data.expectedReservationDetails.kind === "office") {
    return getAssertPrefilledOfficeReservationScript(data, includeContact);
  }

  const expectedReservation = data.expectedReservationDetails;

  return `
(() => {
  const expected = ${JSON.stringify({
    coffee: expectedReservation.coffee,
    ...getCoworkSwitchExpectations(expectedReservation.entryTier, data.locale),
    date: data.date,
    email: data.email,
    includeContact,
    entryTier: expectedReservation.entryTier,
    monitorOption: expectedReservation.monitorOption ?? null,
    name: data.name,
    phone: data.phone,
  })};
  ${getCoworkSwitchSelectionScript()}
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

  if (value('input[name="date"]', 'date') !== expected.date) fail('date');

  const coffee = expected.coffeeSwitchLabel
    ? findSwitchByLabel(expected.coffeeSwitchLabel)
    : undefined;
  if (expected.coffeeSwitchLabel) {
    if (
      !(coffee instanceof HTMLButtonElement) ||
      coffee.getAttribute('aria-checked') !== String(expected.coffee)
    ) {
      fail('coffee switch');
    }
  }
  const workstation = expected.workstationSwitchLabel
    ? findSwitchByLabel(expected.workstationSwitchLabel)
    : undefined;
  if (expected.workstationSwitchLabel) {
    if (
      !(workstation instanceof HTMLButtonElement) ||
      workstation.getAttribute('aria-checked') !==
        String(expected.monitorOption !== null)
    ) {
      fail('workstation switch');
    }
  }
  if (expected.includeContact) {
    if (value('input[name="email"]', 'email') !== expected.email) fail('email');
    if (value('input[name="phone"]', 'phone') !== expected.phone) fail('phone');
    if (value('input[name="name"]', 'name') !== expected.name) fail('name');
    // Booking for someone else repeats the email; a carried-in contact
    // arrives with it already repeated.
    const emailConfirmation = document.querySelector('input[name="emailConfirmation"]');
    if (emailConfirmation !== null && (!(emailConfirmation instanceof HTMLInputElement) || emailConfirmation.value !== expected.email)) fail('repeated email');
  }

  const monitorInputs = [...document.querySelectorAll('input[type="radio"]')]
    .filter((input) => input instanceof HTMLInputElement && input.name !== 'entryTier');
  const selectedMonitor = monitorInputs.find((input) => input.checked);
  if (expected.monitorOption === null) {
    if (monitorInputs.length !== 0) fail('monitor option');
  } else if (!(selectedMonitor instanceof HTMLInputElement) || selectedMonitor.value !== expected.monitorOption) {
    fail('monitor option');
  }

  const marketingConsent = document.querySelector('#reservation-marketing-consent');
  // The consent renders only for someone booking as themselves.
  if (expected.includeContact && marketingConsent !== null && (!(marketingConsent instanceof HTMLButtonElement) || marketingConsent.getAttribute('aria-checked') !== 'false')) fail('marketing consent reset');
  return true;
})()
`;
};

const getAssertPrefilledMeetingRoomReservationScript = (
  data: CheckoutData,
  includeContact: boolean
) => {
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
    includeContact,
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
  // The start-time control is matched by type, not by its localized aria label,
  // so the same predicate asserts en-US and cs-CZ reservation pages.
  const time = document.querySelector('input[type="time"]');
  if (expected.wholeDay) {
    if (time !== null) fail('hidden start time');
  } else if (!(time instanceof HTMLInputElement) || time.value !== expected.time) {
    fail('start time');
  }
  const duration = document.querySelector('input[id^="meeting-room-duration-"]:checked');
  if (!(duration instanceof HTMLInputElement) || duration.value !== expected.durationKey) fail('duration');
  if (expected.includeContact) {
    if (value('input[name="email"]', 'email') !== expected.email) fail('email');
    if (value('input[name="phone"]', 'phone') !== expected.phone) fail('phone');
    if (value('input[name="name"]', 'name') !== expected.name) fail('name');
    // Booking for someone else repeats the email; a carried-in contact
    // arrives with it already repeated.
    const emailConfirmation = document.querySelector('input[name="emailConfirmation"]');
    if (emailConfirmation !== null && (!(emailConfirmation instanceof HTMLInputElement) || emailConfirmation.value !== expected.email)) fail('repeated email');
  }

  const marketingConsent = document.querySelector('#reservation-marketing-consent');
  // The consent renders only for someone booking as themselves.
  if (expected.includeContact && marketingConsent !== null && (!(marketingConsent instanceof HTMLButtonElement) || marketingConsent.getAttribute('aria-checked') !== 'false')) fail('marketing consent reset');
  return true;
})()
`;
};

const getAssertPrefilledOfficeReservationScript = (
  data: CheckoutData,
  includeContact: boolean
) => {
  if (!data.office) {
    throw new Error("Office backfill assertions require range data");
  }

  return `
(() => {
  const expected = ${JSON.stringify({
    email: data.email,
    includeContact,
    dayCount: getOfficeDayCount(data.office),
    name: data.name,
    phone: data.phone,
    seats: data.office.seats,
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
  if (value('input[name="dayCount"]', 'day count') !== String(expected.dayCount)) fail('day count');
  const seats = document.querySelector('input[name="seats"]:checked');
  if (!(seats instanceof HTMLInputElement) || seats.value !== String(expected.seats)) fail('seats');
  if (expected.includeContact) {
    if (value('input[name="email"]', 'email') !== expected.email) fail('email');
    if (value('input[name="phone"]', 'phone') !== expected.phone) fail('phone');
    if (value('input[name="name"]', 'name') !== expected.name) fail('name');
    // Booking for someone else repeats the email; a carried-in contact
    // arrives with it already repeated.
    const emailConfirmation = document.querySelector('input[name="emailConfirmation"]');
    if (emailConfirmation !== null && (!(emailConfirmation instanceof HTMLInputElement) || emailConfirmation.value !== expected.email)) fail('repeated email');
  }

  const marketingConsent = document.querySelector('#reservation-marketing-consent');
  // The consent renders only for someone booking as themselves.
  if (expected.includeContact && marketingConsent !== null && (!(marketingConsent instanceof HTMLButtonElement) || marketingConsent.getAttribute('aria-checked') !== 'false')) fail('marketing consent reset');
  return true;
})()
`;
};

export const getPrefilledReservationConditionScript = (
  data: CheckoutData,
  options: PrefilledReservationOptions = {}
) => {
  const assertion = getAssertPrefilledReservationScript(data, options).trim();

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
    const findMonitorInput = () =>
      [...document.querySelectorAll('input[type="radio"]')].find(
        (candidate) =>
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
        throw new Error('workstation add-on switch not found');
      }
      if (workstationSwitch.getAttribute('aria-checked') !== 'true') {
        workstationSwitch.click();
      }
    }
    let monitorInput;
    await waitUntil(() => {
      monitorInput = findMonitorInput();
      return monitorInput instanceof HTMLInputElement && !monitorInput.disabled;
    }, desiredMonitorOption + ' monitor option was not available');
    const price = document.querySelector(
      '[data-reservation-type-price="' + desiredTier + '"]'
    );
    if (!(price instanceof HTMLElement)) {
      throw new Error(desiredTier + ' advertised price not found');
    }
    // Advertised prices do not depend on the monitor option, and the page
    // renders both Reserved Desk variants already priced, so the selection
    // only has to land on a ready price.
    if (!monitorInput.checked) {
      (monitorInput.closest('label') ?? monitorInput).click();
      await waitUntil(
        () => monitorInput.checked,
        desiredMonitorOption + ' monitor option was not selected'
      );
    }
    await waitUntil(
      () => price.dataset.reservationTypePriceReady === 'true',
      desiredTier + ' advertised price did not become ready after monitor selection'
    );
  }
  return location.href;
})()
`;
};

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

export const getAssertFulfillmentFailedSupportScript = (
  data: CheckoutData,
  orderId: CheckoutRow["reservation_id"]
) => `
(() => {
  const expected = ${JSON.stringify({ locale: data.locale, orderId })};
  const text = document.body?.textContent ?? '';
  if (!/couldn't deliver your confirmation/i.test(text)) {
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

export const assertFulfilledStatusScript = String.raw`
(() => {
  const text = document.body?.textContent ?? '';
  if (document.querySelector('[data-reservation-access]')) {
    throw new Error('reservation access rendered on checkout status page');
  }
  // Only account-origin navigation may intercept the status route. A checkout
  // status rendered in a dialog means the reservation modal slot leaked.
  for (const dialog of document.querySelectorAll('[role="dialog"]')) {
    if (/Your reservation is confirmed\./i.test(dialog.textContent ?? '')) {
      throw new Error('checkout status rendered in a reservation dialog');
    }
  }
  if (/Your reservation is confirmed\./i.test(text) && /emailed you the secure access link/i.test(text)) {
    return location.href;
  }
  throw new Error('fulfilled checkout status copy not visible');
})()
`;
