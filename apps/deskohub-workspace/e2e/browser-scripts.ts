import type { CheckoutData } from "./types";

export const getAssertPrefilledReservationScript = (data: CheckoutData) => {
  if (data.expectedReservationDetails.kind !== "cowork") {
    throw new Error("Reservation backfill assertions require cowork data");
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

export const getPrepareCoworkAdvertisedPriceScript = (data: CheckoutData) => {
  if (data.expectedReservationDetails.kind !== "cowork") {
    throw new Error("Cowork reservation submission requires cowork data");
  }

  const desiredTier = data.expectedReservationDetails.entryTier;
  const desiredMonitorOption =
    data.expectedReservationDetails.monitorOption ?? null;

  return `
(async () => {
  const desiredTier = ${JSON.stringify(desiredTier)};
  const desiredMonitorOption = ${JSON.stringify(desiredMonitorOption)};
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitUntil = async (predicate, label) => {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await wait(250);
    }
    throw new Error(label);
  };
  const selectTierThroughPrice = async (tier, waitForAdvertisedPrice = true) => {
    const price = document.querySelector('[data-reservation-tier-price="' + tier + '"]');
    const input = document.querySelector('#reservation-entry-tier-' + tier);
    if (!(price instanceof HTMLElement) || !(input instanceof HTMLInputElement)) {
      throw new Error(tier + ' tier price control not found');
    }
    price.click();
    await waitUntil(() => input.checked, tier + ' tier was not selected through its price');
    if (waitForAdvertisedPrice) {
      await waitUntil(
        () => price.dataset.reservationTierPriceReady === 'true',
        tier + ' advertised price did not become ready'
      );
    }
  };
  await selectTierThroughPrice(desiredTier, desiredMonitorOption === null);
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
      '[data-reservation-tier-price="' + desiredTier + '"]'
    );
    if (!(price instanceof HTMLElement)) {
      throw new Error(desiredTier + ' advertised price not found');
    }
    if (
      !monitorInput.checked ||
      price.dataset.reservationTierPriceReady !== 'true'
    ) {
      let sawPendingPrice = price.dataset.reservationTierPriceReady === 'false';
      const priceObserver = new MutationObserver((records) => {
        if (records.some((record) => record.oldValue === 'true')) {
          sawPendingPrice = true;
        }
      });
      priceObserver.observe(price, {
        attributeFilter: ['data-reservation-tier-price-ready'],
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
            price.dataset.reservationTierPriceReady === 'true',
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

export const submitPreparedCoworkReservationScript = `
(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitUntil = async (predicate, label) => {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await wait(250);
    }
    throw new Error(label);
  };
  let checkbox;
  await waitUntil(() => {
    const candidate = document.querySelector('#reservation-privacy-consent');
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
  setTimeout(() => button.click(), 0);
  return location.href;
})()
`;

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
