import { expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { MeetingRoomReservationDuration } from "@/features/reservation/meeting-room-reservation-duration";
import { getMeetingRoomReservationInterval } from "@/features/reservation/meeting-room-reservation-time";
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
import { workspaceE2ETimeouts } from "./timeouts";

const workspaceTemporal = globalThis.Temporal;
const oneHourMeetingRoomDuration = { unit: "hour", amount: 1 } as const;
const fourHourMeetingRoomDuration = { unit: "hour", amount: 4 } as const;
const wholeDayMeetingRoomDuration = { unit: "day", amount: 1 } as const;
const getTestMeetingRoomInterval = (
  startDateTime: string,
  duration: MeetingRoomReservationDuration
) => getMeetingRoomReservationInterval(startDateTime, duration);

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
  expect(submitPreparedCoworkReservationScript).toContain("Date.now() + 60000");
  expect(submitPreparedCoworkReservationScript).not.toContain("button.click");
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
    globalThis.Temporal = workspaceTemporal;
  }
});

test("drives meeting-room date, time, duration, and consent controls", () => {
  const interval = getTestMeetingRoomInterval(
    "2099-09-01T10:00",
    fourHourMeetingRoomDuration
  );
  expect(interval).toBeDefined();
  const data = makeMeetingRoomCheckoutData(
    "https://workspace.example.test",
    {
      date: "2099-09-01",
      duration: fourHourMeetingRoomDuration,
      startDateTime: "2099-09-01T10:00",
      ...interval!,
    },
    "meeting-room-script"
  );
  const prepare = getPrepareMeetingRoomAdvertisedPriceScript(data);
  const combined = getSubmitMeetingRoomReservationScript(data);

  expect(prepare).toContain('button[aria-label="Meeting room start date"]');
  expect(prepare).toContain("'[data-day=\"' + expected.date");
  expect(prepare).toContain('input[aria-label="Meeting room start time"]');
  expect(prepare).toContain(
    `Date.now() + ${workspaceE2ETimeouts.reservationPreparation}`
  );
  expect(prepare).toContain("meeting-room-duration-");
  expect(prepare).toContain('"date":"2099-09-01"');
  expect(prepare).toContain('"time":"10:00"');
  expect(prepare).not.toContain("setField('input[name=\"startDateTime\"]'");
  expect(submitPreparedMeetingRoomReservationScript).toContain(
    "reservation-privacy-consent"
  );
  expect(submitPreparedMeetingRoomReservationScript).not.toContain(
    "meeting-room-privacy-consent"
  );
  expect(submitPreparedMeetingRoomReservationScript).not.toContain(
    "button.click"
  );
  expect(combined).toContain(prepare.trim());
  expect(() => new Function(`return ${combined}`)).not.toThrow();
});

test("waits through delayed meeting-room availability readiness", async () => {
  const interval = getTestMeetingRoomInterval(
    "2099-09-02T10:00",
    oneHourMeetingRoomDuration
  );
  expect(interval).toBeDefined();
  const data = makeMeetingRoomCheckoutData(
    "https://workspace.example.test",
    {
      date: "2099-09-02",
      duration: oneHourMeetingRoomDuration,
      startDateTime: "2099-09-02T10:00",
      ...interval!,
    },
    "meeting-room-delayed-readiness"
  );
  GlobalRegistrator.register({
    url: "https://workspace.example.test/en-US/reservation/meeting-room",
  });
  try {
    document.body.innerHTML = `
      <button aria-label="Meeting room start date"></button>
      <div data-day="2099-09-02"><button type="button"></button></div>
      <input aria-label="Meeting room start time" value="10:00" />
      <input id="meeting-room-duration-hour:1" type="radio" value="hour:1" checked />
      <input name="email" />
      <input name="phone" />
      <input name="name" />
      <textarea name="message"></textarea>
      <input name="startDateTime" value="2099-09-02" />
      <button type="submit" disabled></button>
    `;

    let now = 0;
    class FastDate extends Date {
      static override now() {
        now += 1_000;
        return now;
      }
    }
    let pollCount = 0;
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
        FastDate,
        (callback: () => void) => {
          pollCount += 1;
          if (pollCount === 30) {
            document.querySelector<HTMLButtonElement>(
              'button[type="submit"]'
            )!.disabled = false;
          }
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

test("waits for the meeting-room calendar to render the next month", async () => {
  const interval = getTestMeetingRoomInterval(
    "2099-10-01T10:00",
    oneHourMeetingRoomDuration
  );
  expect(interval).toBeDefined();
  const data = makeMeetingRoomCheckoutData(
    "https://workspace.example.test",
    {
      date: "2099-10-01",
      duration: oneHourMeetingRoomDuration,
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
      <input id="meeting-room-duration-hour:1" type="radio" value="hour:1" checked />
      <input name="email" />
      <input name="phone" />
      <input name="name" />
      <textarea name="message"></textarea>
      <input name="startDateTime" value="2099-10-01" />
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

test("waits for the date-only meeting-room state before editing time", async () => {
  const interval = getTestMeetingRoomInterval(
    "2099-10-02T10:00",
    fourHourMeetingRoomDuration
  );
  expect(interval).toBeDefined();
  const data = makeMeetingRoomCheckoutData(
    "https://workspace.example.test",
    {
      date: "2099-10-02",
      duration: fourHourMeetingRoomDuration,
      startDateTime: "2099-10-02T10:00",
      ...interval!,
    },
    "meeting-room-prefilled-date-change"
  );
  GlobalRegistrator.register({
    url: "https://workspace.example.test/en-US/reservation/meeting-room",
  });
  try {
    document.body.innerHTML = `
      <button aria-label="Meeting room start date"></button>
      <div data-day="2099-10-02"><button type="button"></button></div>
      <input aria-label="Meeting room start time" value="10:00" />
      <input id="meeting-room-duration-hour:4" type="radio" value="hour:4" checked />
      <input name="email" />
      <input name="phone" />
      <input name="name" />
      <textarea name="message"></textarea>
      <input name="startDateTime" value="2099-10-01" />
      <button type="submit"></button>
    `;

    const hiddenStart = document.querySelector<HTMLInputElement>(
      'input[name="startDateTime"]'
    )!;
    let dateUpdatePending = false;
    document
      .querySelector('[data-day="2099-10-02"] button')!
      .addEventListener("click", () => {
        dateUpdatePending = true;
        queueMicrotask(() => {
          if (dateUpdatePending) hiddenStart.value = "2099-10-02";
        });
      });
    document
      .querySelector('input[aria-label="Meeting room start time"]')!
      .addEventListener("change", () => {
        if (hiddenStart.value !== "2099-10-02") {
          dateUpdatePending = false;
        }
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

test("follows the current meeting-room duration control after rerender", async () => {
  const interval = getTestMeetingRoomInterval(
    "2099-10-03T10:00",
    fourHourMeetingRoomDuration
  );
  expect(interval).toBeDefined();
  const data = makeMeetingRoomCheckoutData(
    "https://workspace.example.test",
    {
      date: "2099-10-03",
      duration: fourHourMeetingRoomDuration,
      startDateTime: "2099-10-03T10:00",
      ...interval!,
    },
    "meeting-room-duration-rerender"
  );
  GlobalRegistrator.register({
    url: "https://workspace.example.test/en-US/reservation/meeting-room",
  });
  try {
    document.body.innerHTML = `
      <button aria-label="Meeting room start date"></button>
      <div data-day="2099-10-03"><button type="button"></button></div>
      <input aria-label="Meeting room start time" value="10:00" />
      <label id="duration-label">
        <input id="meeting-room-duration-hour:4" type="radio" value="hour:4" />
      </label>
      <input name="email" />
      <input name="phone" />
      <input name="name" />
      <textarea name="message"></textarea>
      <input name="startDateTime" value="2099-10-03" />
      <button type="submit"></button>
    `;
    document
      .querySelector("#duration-label")!
      .addEventListener("click", (event) => {
        event.preventDefault();
        const replacement = document.createElement("input");
        replacement.id = "meeting-room-duration-hour:4";
        replacement.type = "radio";
        replacement.value = "hour:4";
        replacement.checked = true;
        document
          .querySelector('[id="meeting-room-duration-hour:4"]')!
          .replaceWith(replacement);
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

test("asserts restored whole-day meeting-room state and reset legal consent", async () => {
  const interval = getTestMeetingRoomInterval(
    "2099-09-01T00:00",
    wholeDayMeetingRoomDuration
  );
  expect(interval).toBeDefined();
  const data = makeMeetingRoomCheckoutData(
    "https://workspace.example.test",
    {
      date: "2099-09-01",
      duration: wholeDayMeetingRoomDuration,
      startDateTime: "2099-09-01T00:00",
      ...interval!,
    },
    "meeting-room-backfill"
  );
  const assertion = getAssertPrefilledReservationScript(data);

  GlobalRegistrator.register({
    url: "https://workspace.example.test/en-US/reservation/meeting-room",
  });
  try {
    document.body.innerHTML = `
      <input name="startDateTime" value="2099-09-01" />
      <input id="meeting-room-duration-day:1" type="radio" value="day:1" checked />
      <input name="email" value="${data.email}" />
      <input name="phone" value="${data.phone}" />
      <input name="name" value="${data.name}" />
      <textarea name="message">${data.message}</textarea>
      <button id="reservation-privacy-consent" aria-checked="false"></button>
    `;
    const run = new Function(
      "document",
      "HTMLButtonElement",
      "HTMLInputElement",
      "HTMLTextAreaElement",
      `return (${assertion})`
    );

    expect(
      run(document, HTMLButtonElement, HTMLInputElement, HTMLTextAreaElement)
    ).toBe(true);
  } finally {
    await GlobalRegistrator.unregister();
    globalThis.Temporal = workspaceTemporal;
  }
});
