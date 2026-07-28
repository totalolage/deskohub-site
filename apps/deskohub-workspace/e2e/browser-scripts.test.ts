import { expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  getAssertPrefilledReservationScript,
  getPrepareCoworkAdvertisedPriceScript,
  getPrepareMeetingRoomAdvertisedPriceScript,
  getSubmitCoworkReservationScript,
  getSubmitMeetingRoomReservationScript,
  submitPreparedCoworkReservationScript,
  submitPreparedMeetingRoomReservationScript,
} from "./browser-scripts";
import {
  makeCoworkCheckoutData,
  makeMeetingRoomCheckoutData,
} from "./checkout/data";
import { getMeetingRoomReservationInterval } from "@/features/reservation/meeting-room-reservation-time";

const workspaceTemporal = globalThis.Temporal;

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
    <button data-reservation-tier-price="basic" data-reservation-tier-price-ready="true"></button>
    <button data-reservation-tier-price="profi" data-reservation-tier-price-ready="false"></button>
    <input id="reservation-entry-tier-basic" type="radio" disabled />
    <input id="reservation-entry-tier-profi" type="radio" checked />
    <label><input type="radio" value="2x27-qhd" /></label>
  `;

    const basicPrice = document.querySelector<HTMLElement>(
      '[data-reservation-tier-price="basic"]'
    )!;
    const profiPrice = document.querySelector<HTMLElement>(
      '[data-reservation-tier-price="profi"]'
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
      basicPrice.dataset.reservationTierPriceReady = "true";
    });
    profiPrice.addEventListener("click", () => {
      basicInput.checked = false;
      profiInput.checked = true;
      monitorInput.checked = false;
      profiPrice.dataset.reservationTierPriceReady = "false";
    });
    monitorInput.closest("label")!.addEventListener("click", () => {
      monitorInput.checked = true;
      profiPrice.dataset.reservationTierPriceReady = "true";
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
    expect(profiPrice.dataset.reservationTierPriceReady).toBe("true");
  } finally {
    await GlobalRegistrator.unregister();
    globalThis.Temporal = workspaceTemporal;
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
      <button data-reservation-tier-price="profi" data-reservation-tier-price-ready="true"></button>
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
    globalThis.Temporal = workspaceTemporal;
  }
});

test("drives meeting-room date, time, duration, and consent controls", () => {
  const interval = getMeetingRoomReservationInterval("2099-09-01T10:00", 240);
  expect(interval).toBeDefined();
  const data = makeMeetingRoomCheckoutData(
    "https://workspace.example.test",
    {
      date: "2099-09-01",
      durationMinutes: 240,
      startDateTime: "2099-09-01T10:00",
      ...interval!,
    },
    "meeting-room-script"
  );
  const prepare = getPrepareMeetingRoomAdvertisedPriceScript(data);
  const combined = getSubmitMeetingRoomReservationScript(data);

  expect(prepare).toContain('button[aria-label="Meeting room start date"]');
  expect(prepare).toContain("'[data-day=\"' + expected.date");
  expect(prepare).toContain(
    'input[aria-label="Meeting room start time"]'
  );
  expect(prepare).toContain("meeting-room-duration-");
  expect(prepare).toContain("2099-09-01T10:00");
  expect(prepare).not.toContain(
    "setField('input[name=\"startDateTime\"]'"
  );
  expect(submitPreparedMeetingRoomReservationScript).toContain(
    "meeting-room-privacy-consent"
  );
  expect(combined).toContain(prepare.trim());
  expect(() => new Function(`return ${combined}`)).not.toThrow();
});

test("waits for the meeting-room calendar to render the next month", async () => {
  const interval = getMeetingRoomReservationInterval("2099-10-01T10:00", 60);
  expect(interval).toBeDefined();
  const data = makeMeetingRoomCheckoutData(
    "https://workspace.example.test",
    {
      date: "2099-10-01",
      durationMinutes: 60,
      startDateTime: "2099-10-01T10:00",
      ...interval!,
    },
    "meeting-room-next-month"
  );
  GlobalRegistrator.register({
    url: "https://workspace.example.test/en-US/reservation/meeting-room",
  });
  let calendarRender: ReturnType<typeof setTimeout> | undefined;
  try {
    document.body.innerHTML = `
      <button aria-label="Meeting room start date"></button>
      <button aria-label="Go to the Next Month"></button>
      <div data-day="2099-09-30"><button type="button"></button></div>
      <input aria-label="Meeting room start time" />
      <input id="meeting-room-duration-60" type="radio" checked />
      <input name="email" />
      <input name="phone" />
      <input name="name" />
      <textarea name="message"></textarea>
      <input name="startDateTime" value="2099-10-01T10:00" />
      <button type="submit"></button>
    `;

    document
      .querySelector('button[aria-label="Go to the Next Month"]')!
      .addEventListener("click", (event) => {
        (event.currentTarget as HTMLButtonElement).remove();
        calendarRender = setTimeout(() => {
          const day = document.createElement("div");
          day.dataset.day = "2099-10-01";
          const button = document.createElement("button");
          button.type = "button";
          day.append(button);
          document.body.append(day);
        }, 150);
      });

    const run = new Function(
      "document",
      "HTMLElement",
      "HTMLButtonElement",
      "HTMLInputElement",
      "HTMLTextAreaElement",
      "Event",
      "Date",
      "setTimeout",
      "location",
      `return (${getPrepareMeetingRoomAdvertisedPriceScript(data).trim()})`
    );

    await expect(
      run(
        document,
        HTMLElement,
        HTMLButtonElement,
        HTMLInputElement,
        HTMLTextAreaElement,
        Event,
        Date,
        setTimeout,
        location
      )
    ).resolves.toBe(location.href);
  } finally {
    if (calendarRender !== undefined) clearTimeout(calendarRender);
    await GlobalRegistrator.unregister();
    globalThis.Temporal = workspaceTemporal;
  }
});

test("asserts restored meeting-room state and reset legal consent", () => {
  const interval = getMeetingRoomReservationInterval("2099-09-01T10:00", 1440);
  expect(interval).toBeDefined();
  const data = makeMeetingRoomCheckoutData(
    "https://workspace.example.test",
    {
      date: "2099-09-01",
      durationMinutes: 1440,
      startDateTime: "2099-09-01T10:00",
      ...interval!,
    },
    "meeting-room-backfill"
  );
  const assertion = getAssertPrefilledReservationScript(data);

  expect(assertion).toContain("meeting-room-duration-");
  expect(assertion).toContain("2099-09-01T10:00");
  expect(assertion).toContain("meeting-room-privacy-consent");
  expect(assertion).toContain("privacy consent reset");
  expect(() => new Function(`return ${assertion}`)).not.toThrow();
});
