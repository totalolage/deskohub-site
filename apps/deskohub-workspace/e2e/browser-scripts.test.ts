import { expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { MeetingRoomReservationDuration } from "@/features/reservation/meeting-room-reservation-duration";
import { getMeetingRoomReservationInterval } from "@/features/reservation/meeting-room-reservation-time";
import {
  getFillReservationContactScript,
  getPrepareMeetingRoomAdvertisedPriceScript,
  getPrepareOfficeAdvertisedPriceScript,
  submitPreparedCoworkReservationScript,
  submitPreparedMeetingRoomReservationScript,
  submitPreparedOfficeReservationScript,
} from "./browser-scripts";
import {
  makeMeetingRoomCheckoutData,
  makeOfficeCheckoutData,
  type OfficeCheckoutSlot,
} from "./checkout/data";

const workspaceTemporal = globalThis.Temporal;
const oneHourMeetingRoomDuration = { unit: "hour", amount: 1 } as const;
const fourHourMeetingRoomDuration = { unit: "hour", amount: 4 } as const;
const getTestMeetingRoomInterval = (
  startDateTime: string,
  duration: MeetingRoomReservationDuration
) => getMeetingRoomReservationInterval(startDateTime, duration);
const officeSlot: OfficeCheckoutSlot = {
  startsOn: "2099-09-01",
  endsOn: "2099-09-02",
  seats: 2,
  startsAt: "2099-08-31T22:00:00Z" as OfficeCheckoutSlot["startsAt"],
  endsAt: "2099-09-02T22:00:00Z" as OfficeCheckoutSlot["endsAt"],
};

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
