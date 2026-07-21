import type { CheckoutData } from "./types";

export const submitCoworkReservationScript = `
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
  const selectTierThroughPrice = async (tier) => {
    const price = document.querySelector('[data-reservation-tier-price="' + tier + '"]');
    const input = document.querySelector('#reservation-entry-tier-' + tier);
    if (!(price instanceof HTMLElement) || !(input instanceof HTMLInputElement)) {
      throw new Error(tier + ' tier price control not found');
    }
    price.click();
    await waitUntil(() => input.checked, tier + ' tier was not selected through its price');
    await waitUntil(
      () => price.dataset.reservationTierPriceReady === 'true',
      tier + ' advertised price did not become ready'
    );
  };
  await selectTierThroughPrice('plus');
  await selectTierThroughPrice('basic');
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

export const clickStatusReserveAgainScript = `
(() => {
  const link = [...document.querySelectorAll('a')].find((candidate) => /Start a new reservation/i.test(candidate.textContent ?? ''));
  if (!(link instanceof HTMLAnchorElement)) {
    throw new Error('start a new reservation link not found');
  }
  link.click();
  return link.href;
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
