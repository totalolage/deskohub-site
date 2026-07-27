import { expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  getPrepareCoworkAdvertisedPriceScript,
  getSubmitCoworkReservationScript,
  submitPreparedCoworkReservationScript,
} from "./browser-scripts";
import { makeCoworkCheckoutData } from "./checkout/data";

test("keeps advertised-price preparation separable from form submission", () => {
  const data = makeCoworkCheckoutData(
    "https://workspace.example.test",
    "2099-09-01",
    "calendar-pricing-change",
    { entryTier: "profi" }
  );
  const prepare = getPrepareCoworkAdvertisedPriceScript(data);
  const combined = getSubmitCoworkReservationScript(data);

  expect(prepare).toContain("advertised price did not become ready");
  expect(prepare).toContain("2x27-qhd");
  expect(prepare).toContain(
    "advertised price did not refresh after monitor selection"
  );
  expect(prepare).toContain("new MutationObserver");
  expect(prepare).not.toContain("reservation-privacy-consent");
  expect(submitPreparedCoworkReservationScript).toContain(
    "reservation-privacy-consent"
  );
  expect(combined).toContain(prepare.trim());

  expect(() => new Function(`return ${combined}`)).not.toThrow();
  expect(
    () => new Function(`return ${submitPreparedCoworkReservationScript}`)
  ).not.toThrow();
});

test("prepares the Profi advertised price without requiring another tier", async () => {
  const data = makeCoworkCheckoutData(
    "https://workspace.example.test",
    "2099-09-01",
    "calendar-pricing-change",
    { entryTier: "profi" }
  );
  GlobalRegistrator.register({
    url: "https://workspace.example.test/en-US/reservation/cowork",
  });
  try {
    document.body.innerHTML = `
    <button data-reservation-type-price="basic" data-reservation-type-price-ready="true"></button>
    <button data-reservation-type-price="profi" data-reservation-type-price-ready="false"></button>
    <input id="reservation-entry-tier-basic" type="radio" disabled />
    <input id="reservation-entry-tier-profi" type="radio" checked />
    <label><input type="radio" value="2x27-qhd" /></label>
  `;

    const basicPrice = document.querySelector<HTMLElement>(
      '[data-reservation-type-price="basic"]'
    )!;
    const profiPrice = document.querySelector<HTMLElement>(
      '[data-reservation-type-price="profi"]'
    )!;
    const basicInput = document.querySelector<HTMLInputElement>(
      "#reservation-entry-tier-basic"
    )!;
    const profiInput = document.querySelector<HTMLInputElement>(
      "#reservation-entry-tier-profi"
    )!;
    const monitorInput = document.querySelector<HTMLInputElement>(
      'input[value="2x27-qhd"]'
    )!;

    basicPrice.addEventListener("click", () => {
      if (basicInput.disabled) return;
      basicInput.checked = true;
      profiInput.checked = false;
      monitorInput.checked = false;
      basicPrice.dataset.reservationTypePriceReady = "true";
    });
    profiPrice.addEventListener("click", () => {
      basicInput.checked = false;
      profiInput.checked = true;
      monitorInput.checked = false;
      profiPrice.dataset.reservationTypePriceReady = "false";
    });
    monitorInput.closest("label")!.addEventListener("click", () => {
      monitorInput.checked = true;
      profiPrice.dataset.reservationTypePriceReady = "true";
    });

    let now = 0;
    class FastDate extends Date {
      static override now() {
        now += 1_000;
        return now;
      }
    }
    const run = new Function(
      "document",
      "HTMLElement",
      "HTMLInputElement",
      "MutationObserver",
      "Date",
      "setTimeout",
      "location",
      `return (${getPrepareCoworkAdvertisedPriceScript(data).trim()})`
    );

    await expect(
      run(
        document,
        HTMLElement,
        HTMLInputElement,
        MutationObserver,
        FastDate,
        (callback: () => void) => {
          queueMicrotask(callback);
          return 0;
        },
        location
      )
    ).resolves.toBe(location.href);
    expect(profiInput.checked).toBe(true);
    expect(monitorInput.checked).toBe(true);
    expect(profiPrice.dataset.reservationTypePriceReady).toBe("true");
  } finally {
    await GlobalRegistrator.unregister();
  }
});

test("accepts an already-prepared prefilled Profi price", async () => {
  const data = makeCoworkCheckoutData(
    "https://workspace.example.test",
    "2099-09-01",
    "calendar-pricing-change",
    { entryTier: "profi" }
  );
  GlobalRegistrator.register({
    url: "https://workspace.example.test/en-US/reservation/cowork",
  });
  try {
    document.body.innerHTML = `
      <button data-reservation-type-price="profi" data-reservation-type-price-ready="true"></button>
      <input id="reservation-entry-tier-profi" type="radio" checked />
      <label><input type="radio" value="2x27-qhd" checked /></label>
    `;

    let now = 0;
    class FastDate extends Date {
      static override now() {
        now += 1_000;
        return now;
      }
    }
    const run = new Function(
      "document",
      "HTMLElement",
      "HTMLInputElement",
      "MutationObserver",
      "Date",
      "setTimeout",
      "location",
      `return (${getPrepareCoworkAdvertisedPriceScript(data).trim()})`
    );

    await expect(
      run(
        document,
        HTMLElement,
        HTMLInputElement,
        MutationObserver,
        FastDate,
        (callback: () => void) => {
          queueMicrotask(callback);
          return 0;
        },
        location
      )
    ).resolves.toBe(location.href);
  } finally {
    await GlobalRegistrator.unregister();
  }
});
