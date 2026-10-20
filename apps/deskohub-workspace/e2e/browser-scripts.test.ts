import { expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { MeetingRoomReservationDuration } from "@/features/reservation/meeting-room-reservation-duration";
import { getMeetingRoomReservationInterval } from "@/features/reservation/meeting-room-reservation-time";
import {
  assertFulfilledStatusScript,
  getAssertPrefilledReservationScript,
  getAssertRepeatReservationScript,
  getFillReservationContactScript,
  getPrepareCoworkAdvertisedPriceScript,
  getPrepareMeetingRoomAdvertisedPriceScript,
  getPrepareOfficeAdvertisedPriceScript,
  submitPreparedCoworkReservationScript,
  submitPreparedMeetingRoomReservationScript,
  submitPreparedOfficeReservationScript,
} from "./browser-scripts";
import {
  makeCoworkCheckoutData,
  makeMeetingRoomCheckoutData,
  makeOfficeCheckoutData,
} from "./checkout/data";

const workspaceTemporal = globalThis.Temporal;
const oneHourMeetingRoomDuration = { unit: "hour", amount: 1 } as const;
const fourHourMeetingRoomDuration = { unit: "hour", amount: 4 } as const;
const wholeDayMeetingRoomDuration = { unit: "day", amount: 1 } as const;
const getTestMeetingRoomInterval = (
  startDateTime: string,
  duration: MeetingRoomReservationDuration
) => getMeetingRoomReservationInterval(startDateTime, duration);
const officeSlot = {
  startsOn: "2099-09-01",
  endsOn: "2099-09-02",
  seats: 2,
  startsAt: "2099-08-31T22:00:00Z",
  endsAt: "2099-09-02T22:00:00Z",
} as const;

test("asserts safe repeat-reservation defaults for every family", async () => {
  const meetingRoomInterval = getTestMeetingRoomInterval(
    "2099-09-01T10:00",
    fourHourMeetingRoomDuration
  );
  expect(meetingRoomInterval).toBeDefined();

  const scenarios = [
    {
      data: makeCoworkCheckoutData(
        "https://workspace.example.test",
        "2099-09-01",
        "cowork-repeat-open-space"
      ),
      html: `
        <input name="date" value="2099-08-27" />
        <input checked name="entryTier" type="radio" value="open-space" />
        <label id="reservation-coffee-label">Coffee
          <button aria-checked="false" aria-labelledby="reservation-coffee-label" role="switch"></button>
        </label>
      `,
      url: "https://workspace.example.test/en-US/reservation/cowork?entryTier=open-space&coffee=false",
    },
    {
      data: makeCoworkCheckoutData(
        "https://workspace.example.test",
        "2099-09-01",
        "cowork-repeat-reserved-desk",
        { entryTier: "reserved-desk", monitorOption: "2x27-qhd" }
      ),
      html: `
        <input name="date" value="2099-08-27" />
        <input checked name="entryTier" type="radio" value="reserved-desk" />
        <label id="reservation-workstation-label">Monitor workstation
          <button aria-checked="true" aria-labelledby="reservation-workstation-label" role="switch"></button>
        </label>
        <input checked name="monitorOption" type="radio" value="2x27-qhd" />
      `,
      url: "https://workspace.example.test/en-US/reservation/cowork?entryTier=reserved-desk&coffee=true&monitorOption=2x27-qhd",
    },
    {
      data: makeMeetingRoomCheckoutData(
        "https://workspace.example.test",
        {
          date: "2099-09-01",
          duration: fourHourMeetingRoomDuration,
          startDateTime: "2099-09-01T10:00",
          ...meetingRoomInterval!,
        },
        "meeting-room-repeat"
      ),
      html: '<input name="startDateTime" value="2099-08-27" />',
      url: "https://workspace.example.test/en-US/reservation/meeting-room",
    },
    {
      data: makeOfficeCheckoutData(
        "https://workspace.example.test",
        officeSlot
      ),
      html: `
        <input name="startsOn" value="2099-08-27" />
        <input name="dayCount" value="2" />
        <input checked name="seats" type="radio" value="2" />
      `,
      url: "https://workspace.example.test/en-US/reservation/office?dayCount=2&seats=2",
    },
  ];

  for (const scenario of scenarios) {
    GlobalRegistrator.register({ url: scenario.url });
    try {
      document.body.innerHTML = `${scenario.html}
        <input name="email" value="" />
        <input name="phone" value="" />
        <input name="name" value="" />
        <textarea name="message"></textarea>
        <button id="reservation-marketing-consent" aria-checked="false"></button>
      `;
      const run = new Function(
        "document",
        "HTMLButtonElement",
        "HTMLInputElement",
        "HTMLTextAreaElement",
        "location",
        "URLSearchParams",
        `return (${getAssertRepeatReservationScript(scenario.data)})`
      );

      expect(
        run(
          document,
          HTMLButtonElement,
          HTMLInputElement,
          HTMLTextAreaElement,
          location,
          URLSearchParams
        )
      ).toBe(true);
    } finally {
      await GlobalRegistrator.unregister();
      globalThis.Temporal = workspaceTemporal;
    }
  }
});

const runFulfilledStatusAssertion = (body: string) => {
  document.body.innerHTML = body;
  return new Function(
    "document",
    "location",
    `return (${assertFulfilledStatusScript.trim()})`
  )(document, location);
};

test("accepts only the canonical fulfilled checkout status page", async () => {
  GlobalRegistrator.register({
    url: "https://workspace.example.test/en-US/reservation/status/order",
  });
  try {
    const statusCopy =
      "<p>Your reservation is confirmed. Your payment is complete and we've emailed you the secure access link.</p>";

    expect(
      runFulfilledStatusAssertion(
        `<main>${statusCopy}</main><div role="dialog">Cookie settings</div>`
      )
    ).toBe(location.href);
    expect(() =>
      runFulfilledStatusAssertion(
        `<main>${statusCopy}<div data-reservation-access=""></div></main>`
      )
    ).toThrow("reservation access rendered on checkout status page");
    expect(() =>
      runFulfilledStatusAssertion(`<div role="dialog">${statusCopy}</div>`)
    ).toThrow("checkout status rendered in a reservation dialog");
  } finally {
    await GlobalRegistrator.unregister();
    globalThis.Temporal = workspaceTemporal;
  }
});

test.each([
  ["cowork", submitPreparedCoworkReservationScript],
  ["meeting-room", submitPreparedMeetingRoomReservationScript],
  ["office", submitPreparedOfficeReservationScript],
])(
  "submits a prepared %s reservation natively once the button enables",
  async (_family, script) => {
    GlobalRegistrator.register({
      url: "https://workspace.example.test/en-US/reservation",
    });
    try {
      const run = new Function(
        "document",
        "HTMLButtonElement",
        "HTMLFormElement",
        "setTimeout",
        "location",
        `return (${script.trim()})`
      );
      const runWith = (onWait: () => void) =>
        run(
          document,
          HTMLButtonElement,
          HTMLFormElement,
          (callback: () => void) => {
            onWait();
            queueMicrotask(callback);
            return 0;
          },
          location
        );

      document.body.innerHTML =
        '<form><button id="reservation-submit" disabled>Reserve</button></form>';
      const button = document.querySelector<HTMLButtonElement>(
        "#reservation-submit"
      )!;
      const activations: string[] = [];
      button.addEventListener("click", () => activations.push("click"));
      button.form!.addEventListener("submit", (event) => {
        event.preventDefault();
        activations.push("submit");
      });

      await expect(
        runWith(() => {
          button.disabled = false;
        })
      ).resolves.toBe(location.href);
      expect(activations).toEqual([]);

      document.body.innerHTML =
        '<button id="reservation-submit">Reserve</button>';
      await expect(runWith(() => undefined)).rejects.toThrow(
        "reservation form not found"
      );
    } finally {
      await GlobalRegistrator.unregister();
      globalThis.Temporal = workspaceTemporal;
    }
  }
);

test("prepares the Reserved Desk advertised price without requiring another tier", async () => {
  const data = makeCoworkCheckoutData(
    "https://workspace.example.test",
    "2099-09-01",
    "calendar-pricing-change",
    { entryTier: "reserved-desk", monitorOption: "2x27-qhd" }
  );
  GlobalRegistrator.register({
    url: "https://workspace.example.test/en-US/reservation/cowork",
  });
  try {
    document.body.innerHTML = `
    <input name="date" value="2099-09-01" />
    <button data-reservation-type-price="reserved-desk" data-reservation-type-price-ready="false"></button>
    <input id="reservation-entry-tier-reserved-desk" type="radio" checked />
    <label><input type="radio" value="2x27-qhd" /></label>
  `;

    const reservedDeskPrice = document.querySelector<HTMLElement>(
      '[data-reservation-type-price="reserved-desk"]'
    )!;
    const reservedDeskInput = document.querySelector<HTMLInputElement>(
      "#reservation-entry-tier-reserved-desk"
    )!;
    const monitorInput = document.querySelector<HTMLInputElement>(
      'input[value="2x27-qhd"]'
    )!;

    reservedDeskPrice.addEventListener("click", () => {
      reservedDeskInput.checked = true;
      monitorInput.checked = false;
      reservedDeskPrice.dataset.reservationTypePriceReady = "false";
    });
    monitorInput.closest("label")!.addEventListener("click", () => {
      monitorInput.checked = true;
      reservedDeskPrice.dataset.reservationTypePriceReady = "true";
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
    expect(reservedDeskInput.checked).toBe(true);
    expect(monitorInput.checked).toBe(true);
    expect(reservedDeskPrice.dataset.reservationTypePriceReady).toBe("true");
  } finally {
    await GlobalRegistrator.unregister();
    globalThis.Temporal = workspaceTemporal;
  }
});

test("selects a monitor over a page-loaded Reserved Desk price", async () => {
  const data = makeCoworkCheckoutData(
    "https://workspace.example.test",
    "2099-09-01",
    "calendar-pricing-change",
    { entryTier: "reserved-desk", monitorOption: "2x27-qhd" }
  );
  GlobalRegistrator.register({
    url: "https://workspace.example.test/en-US/reservation/cowork",
  });
  try {
    // The page renders both Reserved Desk variants priced, so choosing the
    // monitor never takes the price back to pending.
    document.body.innerHTML = `
    <input name="date" value="2099-09-01" />
    <button data-reservation-type-price="reserved-desk" data-reservation-type-price-ready="true"></button>
    <input id="reservation-entry-tier-reserved-desk" type="radio" checked />
    <label><input type="radio" value="2x27-qhd" /></label>
  `;

    const monitorInput = document.querySelector<HTMLInputElement>(
      'input[value="2x27-qhd"]'
    )!;
    monitorInput.closest("label")!.addEventListener("click", () => {
      monitorInput.checked = true;
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
    expect(monitorInput.checked).toBe(true);
  } finally {
    await GlobalRegistrator.unregister();
    globalThis.Temporal = workspaceTemporal;
  }
});

test("turns the workstation on before choosing a monitor", async () => {
  const data = makeCoworkCheckoutData(
    "https://workspace.example.test",
    "2099-09-01",
    "url-state-cowork",
    { entryTier: "reserved-desk", monitorOption: "2x32-qhd" }
  );
  GlobalRegistrator.register({
    url: "https://workspace.example.test/en-US/reservation/cowork",
  });
  try {
    // Monitor options render only after the workstation switch is on.
    document.body.innerHTML = `
    <input name="date" value="2099-09-01" />
    <button data-reservation-type-price="reserved-desk" data-reservation-type-price-ready="true"></button>
    <input id="reservation-entry-tier-reserved-desk" type="radio" checked />
    <div data-cowork-optional-addon-toggle="workstation">
      <button role="switch" aria-checked="false"></button>
    </div>
  `;

    const workstationSwitch =
      document.querySelector<HTMLElement>('[role="switch"]')!;
    workstationSwitch.addEventListener("click", () => {
      workstationSwitch.setAttribute("aria-checked", "true");
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div data-cowork-monitor-options>
          <label><input type="radio" value="2x27-qhd" checked /></label>
          <label><input type="radio" value="2x32-qhd" /></label>
        </div>`
      );
      const monitorInput = document.querySelector<HTMLInputElement>(
        'input[value="2x32-qhd"]'
      )!;
      monitorInput.closest("label")!.addEventListener("click", () => {
        monitorInput.checked = true;
      });
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
    expect(workstationSwitch.getAttribute("aria-checked")).toBe("true");
    expect(
      document.querySelector<HTMLInputElement>('input[value="2x32-qhd"]')
        ?.checked
    ).toBe(true);
  } finally {
    await GlobalRegistrator.unregister();
    globalThis.Temporal = workspaceTemporal;
  }
});

test("accepts an already-prepared prefilled Reserved Desk price", async () => {
  const data = makeCoworkCheckoutData(
    "https://workspace.example.test",
    "2099-09-01",
    "calendar-pricing-change",
    { entryTier: "reserved-desk", monitorOption: "2x27-qhd" }
  );
  GlobalRegistrator.register({
    url: "https://workspace.example.test/en-US/reservation/cowork",
  });
  try {
    document.body.innerHTML = `
      <input name="date" value="2099-09-01" />
      <button data-reservation-type-price="reserved-desk" data-reservation-type-price-ready="true"></button>
      <input id="reservation-entry-tier-reserved-desk" type="radio" checked />
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

test("selects an edited cowork date and waits for its advertised price", async () => {
  const data = makeCoworkCheckoutData(
    "https://workspace.example.test",
    "2099-10-02",
    "cowork-reservation-replacement"
  );
  GlobalRegistrator.register({
    url: "https://workspace.example.test/en-US/reservation/cowork",
  });
  try {
    document.body.innerHTML = `
      <button aria-haspopup="dialog" type="button"></button>
      <div data-day="2099-10-02"><button type="button"></button></div>
      <input name="date" value="2099-10-01" />
      <button data-reservation-type-price="open-space" data-reservation-type-price-ready="true"></button>
      <input id="reservation-entry-tier-open-space" type="radio" checked />
    `;

    const hiddenDate =
      document.querySelector<HTMLInputElement>('input[name="date"]')!;
    const price = document.querySelector<HTMLElement>(
      '[data-reservation-type-price="open-space"]'
    )!;
    document
      .querySelector('[data-day="2099-10-02"] button')!
      .addEventListener("click", () => {
        hiddenDate.value = "2099-10-02";
        price.dataset.reservationTypePriceReady = "false";
        queueMicrotask(() => {
          price.dataset.reservationTypePriceReady = "true";
        });
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
        HTMLButtonElement,
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
    expect(hiddenDate.value).toBe("2099-10-02");
    expect(price.dataset.reservationTypePriceReady).toBe("true");
  } finally {
    await GlobalRegistrator.unregister();
    globalThis.Temporal = workspaceTemporal;
  }
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
      <button id="reservation-continue" type="button" disabled></button>
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
              "#reservation-continue"
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

test("picks a listed meeting-room start time instead of typing it", async () => {
  const interval = getTestMeetingRoomInterval(
    "2099-09-02T14:00",
    oneHourMeetingRoomDuration
  );
  expect(interval).toBeDefined();
  const data = makeMeetingRoomCheckoutData(
    "https://workspace.example.test",
    {
      date: "2099-09-02",
      duration: oneHourMeetingRoomDuration,
      startDateTime: "2099-09-02T14:00",
      ...interval!,
    },
    "meeting-room-listed-start"
  );
  GlobalRegistrator.register({
    url: "https://workspace.example.test/en-US/reservation/meeting-room",
  });
  try {
    document.body.innerHTML = `
      <button aria-label="Meeting room start date"></button>
      <div data-day="2099-09-02"><button type="button"></button></div>
      <input aria-label="Meeting room start time" value="10:00" />
      <div id="start-times"></div>
      <input id="meeting-room-duration-hour:1" type="radio" value="hour:1" checked />
      <input name="email" />
      <input name="phone" />
      <input name="name" />
      <textarea name="message"></textarea>
      <input name="startDateTime" value="2099-09-02" />
      <button id="reservation-continue" type="button"></button>
    `;
    const time = document.querySelector<HTMLInputElement>(
      'input[aria-label="Meeting room start time"]'
    )!;
    const typedTimes: string[] = [];
    time.addEventListener("input", () => typedTimes.push(time.value));

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
      `return (${getPrepareMeetingRoomAdvertisedPriceScript(data, {
        startTimeEntry: "listed",
      }).trim()})`
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
        (callback: () => void) => {
          pollCount += 1;
          // The free start times arrive after the date and duration are set.
          if (pollCount === 3) {
            document.querySelector("#start-times")!.innerHTML = `
              <div role="radiogroup">
                <label><input type="radio" value="2099-09-02T13:00" /></label>
                <label id="listed-start"><input type="radio" value="2099-09-02T14:00" /></label>
              </div>
            `;
            document
              .querySelector("#listed-start")!
              .addEventListener("click", () => {
                time.value = "14:00";
              });
          }
          queueMicrotask(callback);
          return 0;
        },
        location
      )
    ).resolves.toBe(location.href);
    expect(time.value).toBe("14:00");
    expect(typedTimes).toEqual([]);
  } finally {
    await GlobalRegistrator.unregister();
    globalThis.Temporal = workspaceTemporal;
  }
});

test("checks meeting-room readiness once at the existing deadline", async () => {
  const interval = getTestMeetingRoomInterval(
    "2099-09-03T10:00",
    oneHourMeetingRoomDuration
  );
  expect(interval).toBeDefined();
  const data = makeMeetingRoomCheckoutData(
    "https://workspace.example.test",
    {
      date: "2099-09-03",
      duration: oneHourMeetingRoomDuration,
      startDateTime: "2099-09-03T10:00",
      ...interval!,
    },
    "meeting-room-deadline-readiness"
  );
  GlobalRegistrator.register({
    url: "https://workspace.example.test/en-US/reservation/meeting-room",
  });
  try {
    document.body.innerHTML = `
      <button aria-label="Meeting room start date"></button>
      <div data-day="2099-09-03"><button type="button"></button></div>
      <input aria-label="Meeting room start time" value="10:00" />
      <input id="meeting-room-duration-hour:1" type="radio" value="hour:1" checked />
      <input name="email" />
      <input name="phone" />
      <input name="name" />
      <textarea name="message"></textarea>
      <input name="startDateTime" value="2099-09-03" />
      <button id="reservation-continue" type="button" disabled></button>
    `;

    let now = 0;
    class DeadlineDate extends Date {
      static override now() {
        now += 15_000;
        return now;
      }
    }
    let waits = 0;
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
        DeadlineDate,
        (callback: () => void) => {
          waits += 1;
          if (waits === 2) {
            document.querySelector<HTMLButtonElement>(
              "#reservation-continue"
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

test("retries the selected meeting-room price at most once", async () => {
  const interval = getTestMeetingRoomInterval(
    "2099-09-04T10:00",
    oneHourMeetingRoomDuration
  );
  expect(interval).toBeDefined();
  const data = makeMeetingRoomCheckoutData(
    "https://workspace.example.test",
    {
      date: "2099-09-04",
      duration: oneHourMeetingRoomDuration,
      startDateTime: "2099-09-04T10:00",
      ...interval!,
    },
    "meeting-room-price-retry"
  );
  GlobalRegistrator.register({
    url: "https://workspace.example.test/en-US/reservation/meeting-room",
  });
  try {
    document.body.innerHTML = `
      <button aria-label="Meeting room start date"></button>
      <div data-day="2099-09-04"><button type="button"></button></div>
      <input aria-label="Meeting room start time" value="10:00" />
      <input id="meeting-room-duration-hour:1" type="radio" value="hour:1" checked />
      <input name="email" />
      <input name="phone" />
      <input name="name" />
      <textarea name="message"></textarea>
      <input name="startDateTime" value="2099-09-04" />
      <button
        data-reservation-availability-loading="false"
        data-reservation-price-error="true"
        data-reservation-price-loading="false"
        data-reservation-unavailable="false"
        id="reservation-continue"
        type="button"
        disabled
      ></button>
      <button id="reservation-advertised-price-retry" type="button"></button>
    `;

    let retryCount = 0;
    document
      .querySelector("#reservation-advertised-price-retry")!
      .addEventListener("click", () => {
        retryCount += 1;
      });
    let now = 0;
    class FastDate extends Date {
      static override now() {
        now += 10_000;
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
    ).rejects.toThrow(
      "price_error=true; price_loading=false; unavailable=false; " +
        "price_retry_available=true; price_retry_attempted=true"
    );
    expect(retryCount).toBe(1);
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
      <button id="reservation-continue" type="button"></button>
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
      <button id="reservation-continue" type="button"></button>
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
      <button id="reservation-continue" type="button"></button>
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

test("asserts restored whole-day meeting-room state and reset marketing consent", async () => {
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
      <button id="reservation-marketing-consent" aria-checked="false"></button>
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

test("asserts meeting-room prefills without locale-specific labels", async () => {
  const interval = getTestMeetingRoomInterval(
    "2099-09-01T10:00",
    oneHourMeetingRoomDuration
  );
  expect(interval).toBeDefined();
  const data = makeMeetingRoomCheckoutData(
    "https://workspace.example.test",
    {
      date: "2099-09-01",
      duration: oneHourMeetingRoomDuration,
      startDateTime: "2099-09-01T10:00",
      ...interval!,
    },
    "meeting-room-prefill"
  );
  const assertion = getAssertPrefilledReservationScript(data);

  GlobalRegistrator.register({
    url: "https://workspace.example.test/cs-CZ/reservation/meeting-room",
  });
  try {
    document.body.innerHTML = `
      <input name="startDateTime" value="2099-09-01" />
      <input type="time" value="10:00" aria-label="Začátek rezervace" />
      <input id="meeting-room-duration-hour:1" type="radio" value="hour:1" checked />
      <input name="email" value="${data.email}" />
      <input name="phone" value="${data.phone}" />
      <input name="name" value="${data.name}" />
      <textarea name="message">${data.message}</textarea>
      <button id="reservation-marketing-consent" aria-checked="false"></button>
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

test("prepares a multi-day office reservation with selected seats", async () => {
  const data = makeOfficeCheckoutData(
    "https://workspace.example.test",
    officeSlot
  );
  const prepare = getPrepareOfficeAdvertisedPriceScript(data);

  GlobalRegistrator.register({
    url: "https://workspace.example.test/en-US/reservation/office",
  });
  try {
    document.body.innerHTML = `
      <button aria-label="Office reservation start date" type="button"></button>
      <div data-day="${officeSlot.startsOn}"><button type="button"></button></div>
      <input name="startsOn" value="" />
      <input name="dayCount" type="number" value="1" />
      <input name="seats" type="radio" value="1" />
      <input checked name="seats" type="radio" value="2" />
      <input name="email" />
      <input name="phone" />
      <input name="name" />
      <textarea name="message"></textarea>
      <button
        data-reservation-availability-loading="false"
        data-reservation-price-loading="false"
        id="reservation-continue"
        type="button"
      ></button>
    `;
    for (const dateButton of document.querySelectorAll<HTMLButtonElement>(
      "[data-day] button"
    )) {
      dateButton.addEventListener("click", () => {
        const selectedDate = dateButton.parentElement?.dataset.day;
        if (!selectedDate) return;
        const input = document.querySelector<HTMLInputElement>(
          'input[name="startsOn"]'
        );
        if (!input) return;
        input.value = selectedDate;
        const submit = document.querySelector<HTMLButtonElement>(
          "#reservation-continue"
        );
        if (submit) submit.dataset.reservationPriceLoading = "true";
        setTimeout(() => {
          if (submit) submit.dataset.reservationPriceLoading = "false";
        }, 20);
      });
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
      `return (${prepare.trim()})`
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
    expect(
      document.querySelector<HTMLInputElement>('input[name="dayCount"]')?.value
    ).toBe("2");
    expect(
      document.querySelector<HTMLInputElement>('input[name="seats"]:checked')
        ?.value
    ).toBe("2");
    // The contact is filled on the contact step, not with the selection.
    expect(
      document.querySelector<HTMLInputElement>('input[name="email"]')?.value
    ).toBe("");
  } finally {
    await GlobalRegistrator.unregister();
    globalThis.Temporal = workspaceTemporal;
  }
});

test("asserts restored cowork switches for both current offers", async () => {
  const runCoworkPrefill = (
    data: ReturnType<typeof makeCoworkCheckoutData>
  ) => {
    const script = getAssertPrefilledReservationScript(data);
    const run = new Function(
      "document",
      "HTMLButtonElement",
      "HTMLInputElement",
      "HTMLTextAreaElement",
      `return (${script})`
    );
    return () =>
      run(document, HTMLButtonElement, HTMLInputElement, HTMLTextAreaElement);
  };
  const renderCoworkPrefill = (
    data: ReturnType<typeof makeCoworkCheckoutData>,
    switchHtml: string,
    monitorHtml: string
  ) => {
    document.body.innerHTML = `
      <input checked name="entryTier" type="radio" value="${data.expectedReservationDetails.entryTier}" />
      <input name="date" type="hidden" value="${data.date}" />
      ${switchHtml}
      <input name="email" value="${data.email}" />
      <input name="phone" value="${data.phone}" />
      <input name="name" value="${data.name}" />
      <textarea name="message">${data.message}</textarea>
      ${monitorHtml}
      <button id="reservation-marketing-consent" aria-checked="false"></button>
    `;
  };

  const openSpace = makeCoworkCheckoutData(
    "https://workspace.example.test",
    "2099-09-01",
    "cowork-prefill-open-space",
    { coffee: true }
  );
  const openSpaceSwitch = (coffeeChecked: boolean) => `
      <label id="reservation-coffee-label">Coffee
        <button aria-checked="${coffeeChecked}" aria-labelledby="reservation-coffee-label" role="switch"></button>
      </label>
    `;

  GlobalRegistrator.register({
    url: "https://workspace.example.test/en-US/reservation/cowork",
  });
  try {
    renderCoworkPrefill(openSpace, openSpaceSwitch(true), "");
    expect(runCoworkPrefill(openSpace)()).toBe(true);

    renderCoworkPrefill(openSpace, openSpaceSwitch(false), "");
    expect(runCoworkPrefill(openSpace)).toThrow(/coffee switch/);
  } finally {
    await GlobalRegistrator.unregister();
    globalThis.Temporal = workspaceTemporal;
  }

  const reservedDesk = makeCoworkCheckoutData(
    "https://workspace.example.test",
    "2099-09-01",
    "cowork-prefill-reserved-desk",
    { entryTier: "reserved-desk", monitorOption: "2x27-qhd" }
  );
  const workstationSwitch = (workstationChecked: boolean) => `
      <label id="reservation-workstation-label">Monitor workstation
        <button aria-checked="${workstationChecked}" aria-labelledby="reservation-workstation-label" role="switch"></button>
      </label>
    `;
  const reservedDeskMonitor = `
      <input checked name="monitorOption" type="radio" value="2x27-qhd" />
    `;

  GlobalRegistrator.register({
    url: "https://workspace.example.test/en-US/reservation/cowork",
  });
  try {
    renderCoworkPrefill(
      reservedDesk,
      workstationSwitch(true),
      reservedDeskMonitor
    );
    expect(runCoworkPrefill(reservedDesk)()).toBe(true);

    renderCoworkPrefill(
      reservedDesk,
      workstationSwitch(false),
      reservedDeskMonitor
    );
    expect(runCoworkPrefill(reservedDesk)).toThrow(/workstation switch/);
  } finally {
    await GlobalRegistrator.unregister();
    globalThis.Temporal = workspaceTemporal;
  }
});

test("asserts restored office range, seats, and reset marketing consent", async () => {
  const data = makeOfficeCheckoutData(
    "https://workspace.example.test",
    officeSlot
  );
  const assertion = getAssertPrefilledReservationScript(data);

  GlobalRegistrator.register({
    url: "https://workspace.example.test/en-US/reservation/office",
  });
  try {
    document.body.innerHTML = `
      <input name="startsOn" value="${officeSlot.startsOn}" />
      <input name="dayCount" type="number" value="2" />
      <input checked name="seats" type="radio" value="${officeSlot.seats}" />
      <input name="email" value="${data.email}" />
      <input name="phone" value="${data.phone}" />
      <input name="name" value="${data.name}" />
      <textarea name="message">${data.message}</textarea>
      <button id="reservation-marketing-consent" aria-checked="false"></button>
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

test("fills only the contact step's rendered, editable contact inputs", async () => {
  const data = makeOfficeCheckoutData(
    "https://workspace.example.test",
    officeSlot
  );
  const fill = getFillReservationContactScript(data);

  GlobalRegistrator.register({
    url: "https://workspace.example.test/en-US/reservation/office?step=contact",
  });
  try {
    const run = () =>
      new Function(
        "document",
        "HTMLInputElement",
        "HTMLFormElement",
        "Event",
        "location",
        `return (${fill.trim()})`
      )(document, HTMLInputElement, HTMLFormElement, Event, location);
    const value = (name: string) =>
      document.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value;

    // Booking for someone else: every contact input, the email repeated.
    document.body.innerHTML = `
      <form>
        <div hidden><input name="date" /></div>
        <div>
          <input name="name" />
          <input name="email" />
          <input name="emailConfirmation" />
          <input name="phone" />
        </div>
        <button id="reservation-submit" type="submit"></button>
      </form>
    `;
    await expect(run()).resolves.toBe(location.href);
    expect(value("name")).toBe(data.name);
    expect(value("email")).toBe(data.email);
    expect(value("emailConfirmation")).toBe(data.email);
    expect(value("phone")).toBe(data.phone);

    // A profile-missing account's email is its read-only login email.
    document.body.innerHTML = `
      <form>
        <input name="name" />
        <input name="email" readonly value="${testEmailAddress("account")}" />
        <input name="phone" />
        <button id="reservation-submit" type="submit"></button>
      </form>
    `;
    await expect(run()).resolves.toBe(location.href);
    expect(value("email")).toBe(testEmailAddress("account"));
    expect(value("name")).toBe(data.name);

    // Booking as a linked account renders no contact inputs.
    document.body.innerHTML = `
      <form>
        <section aria-labelledby="reservation-existing-customer-heading"></section>
        <button id="reservation-submit" type="submit"></button>
      </form>
    `;
    await expect(run()).resolves.toBe(location.href);

    // The selection step keeps the contact step hidden.
    document.body.innerHTML = `
      <form>
        <div hidden><input name="name" /></div>
        <button id="reservation-continue" type="button"></button>
      </form>
    `;
    await expect(run()).rejects.toThrow(
      "reservation contact step is not shown"
    );
  } finally {
    await GlobalRegistrator.unregister();
    globalThis.Temporal = workspaceTemporal;
  }
});
