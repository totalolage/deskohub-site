import "../../shared/polyfills/temporal";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { type Browser, chromium, type Page } from "@playwright/test";
import type { MeetingRoomReservationDuration } from "@/features/reservation/meeting-room-reservation-duration";
import { getMeetingRoomReservationInterval } from "@/features/reservation/meeting-room-reservation-time";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import type { CheckoutData } from "../types";
import {
  makeCoworkCheckoutData,
  makeMeetingRoomCheckoutData,
  makeOfficeCheckoutData,
  type OfficeCheckoutSlot,
} from "./data";
import {
  preparedReservationForm,
  prepareReservationForm,
  type ReservationFormPreparation,
  readReservationPreparationState,
  toReservationSelection,
  toReservationSelectionPreparation,
  toReservationStep,
} from "./reservation-form-preparation";

const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;
let page: Page | undefined;

beforeAll(async () => {
  if (!chromiumAvailable) return;
  browser = await chromium.launch({ headless: true });
});

beforeEach(async () => {
  if (!browser) return;
  page = await browser.newPage();
});

afterEach(async () => {
  await page?.close();
  page = undefined;
});

afterAll(async () => {
  await browser?.close();
});

const origin = "https://workspace.example.test";
const oneHour = {
  unit: "hour",
  amount: 1,
} as const satisfies MeetingRoomReservationDuration;
const fourHours = {
  unit: "hour",
  amount: 4,
} as const satisfies MeetingRoomReservationDuration;
const officeSlot: OfficeCheckoutSlot = {
  startsOn: "2099-09-01",
  endsOn: "2099-09-02",
  seats: 2,
  startsAt: "2099-08-31T22:00:00Z" as OfficeCheckoutSlot["startsAt"],
  endsAt: "2099-09-02T22:00:00Z" as OfficeCheckoutSlot["endsAt"],
};

const getPage = () => {
  if (!page) throw new Error("Chromium is not running");
  return page;
};

const prepareOn = async (
  html: string,
  preparation: ReservationFormPreparation
) => {
  const currentPage = getPage();
  await currentPage.setContent(html);
  return currentPage.evaluate(prepareReservationForm, { preparation });
};

const withWaits = (
  preparation: ReservationFormPreparation,
  waitTimeoutMs = 1_500,
  actionTimeoutMs = 1_500
): ReservationFormPreparation => {
  switch (preparation.kind) {
    case "selection":
      return {
        ...preparation,
        selection: { ...preparation.selection, waitTimeoutMs },
      };
    case "step":
      return {
        ...preparation,
        actionTimeoutMs,
        selection: { ...preparation.selection, waitTimeoutMs },
      };
    case "prepared":
      return { ...preparation, actionTimeoutMs };
  }
};

const meetingRoomData = (
  startDateTime: string,
  duration: MeetingRoomReservationDuration,
  flowId: string
) => {
  const interval = getMeetingRoomReservationInterval(startDateTime, duration);
  if (!interval) throw new Error("meeting-room test interval unavailable");
  return makeMeetingRoomCheckoutData(
    origin,
    {
      date: startDateTime.slice(0, 10),
      duration,
      startDateTime,
      ...interval,
    },
    flowId
  );
};

const meetingRoomHtml = ({
  date,
  initialDate = date,
  visibleDate = date,
  time = "10:00",
  durationKey = "hour:1",
  durationControl,
  disabled = false,
  extraMarkup = "",
  dateUpdate = "sync",
  script = "",
}: {
  date: string;
  initialDate?: string;
  visibleDate?: string;
  time?: string;
  durationKey?: string;
  durationControl?: string;
  disabled?: boolean;
  extraMarkup?: string;
  dateUpdate?: "sync" | "none";
  script?: string;
}) => `
  <form>
    <button aria-label="Meeting room start date" type="button"></button>
    ${extraMarkup}
    <div data-day="${visibleDate}"><button type="button"></button></div>
    <input aria-label="Meeting room start time" value="${time}" />
    ${durationControl ?? `<input id="meeting-room-duration-${durationKey}" type="radio" value="${durationKey}" checked />`}
    <input name="email" />
    <input name="phone" />
    <input name="name" />
    <textarea name="message"></textarea>
    <input name="startDateTime" value="${initialDate}" />
    <button id="reservation-continue" type="button" ${disabled ? "disabled" : ""}></button>
  </form>
  <script>
    ${
      dateUpdate === "sync"
        ? `document.addEventListener("click", (event) => {
            const target = event.target;
            const button = target instanceof Element ? target.closest("[data-day] button") : null;
            const date = button?.closest("[data-day]")?.getAttribute("data-day");
            if (date) document.querySelector('input[name="startDateTime"]').value = date;
          });`
        : ""
    }
    ${script}
  </script>
`;

describe("meeting-room reservation preparation in Chromium", () => {
  test.skipIf(!chromiumAvailable)(
    "waits through delayed meeting-room availability readiness",
    async () => {
      const data = meetingRoomData(
        "2099-09-02T10:00",
        oneHour,
        "meeting-room-delayed-readiness"
      );
      const html = meetingRoomHtml({
        date: data.date,
        disabled: true,
        script: `setTimeout(() => {
          document.querySelector("#reservation-continue").disabled = false;
        }, 350);`,
      });

      await expect(
        prepareOn(
          html,
          withWaits(toReservationSelectionPreparation(data), 2_000)
        )
      ).resolves.toBe("about:blank");
    }
  );

  test.skipIf(!chromiumAvailable)(
    "picks a listed meeting-room start time instead of typing it",
    async () => {
      const data = meetingRoomData(
        "2099-09-02T14:00",
        oneHour,
        "meeting-room-listed-start"
      );
      const html = meetingRoomHtml({
        date: data.date,
        extraMarkup: `<div id="start-times"></div>`,
        script: `
          const time = document.querySelector('input[aria-label="Meeting room start time"]');
          setTimeout(() => {
            document.querySelector("#start-times").innerHTML =
              '<div role="radiogroup">' +
              '<label><input type="radio" value="2099-09-02T13:00" /></label>' +
              '<label id="listed-start"><input type="radio" value="2099-09-02T14:00" /></label>' +
              '</div>';
            document.querySelector('#listed-start input').addEventListener("change", () => {
              time.value = "14:00";
            });
          }, 100);
        `,
      });
      const currentPage = getPage();
      await currentPage.setContent(html);
      await currentPage.evaluate(() => {
        (
          globalThis as typeof globalThis & { typedTimes?: string[] }
        ).typedTimes = [];
        document
          .querySelector('input[aria-label="Meeting room start time"]')!
          .addEventListener("input", (event) => {
            const target = event.currentTarget as HTMLInputElement;
            (
              globalThis as typeof globalThis & { typedTimes?: string[] }
            ).typedTimes!.push(target.value);
          });
      });

      await expect(
        currentPage.evaluate(prepareReservationForm, {
          preparation: withWaits(
            toReservationSelectionPreparation(data, {
              startTimeEntry: "listed",
            }),
            2_000
          ),
        })
      ).resolves.toBe("about:blank");
      await expect(
        currentPage.evaluate(() => ({
          time: document.querySelector<HTMLInputElement>(
            'input[aria-label="Meeting room start time"]'
          )?.value,
          typedTimes: (
            globalThis as typeof globalThis & { typedTimes?: string[] }
          ).typedTimes,
        }))
      ).resolves.toEqual({ time: "14:00", typedTimes: [] });
    }
  );

  test.skipIf(!chromiumAvailable)(
    "checks readiness once after the meeting-room deadline",
    async () => {
      const data = meetingRoomData(
        "2099-09-03T10:00",
        oneHour,
        "meeting-room-deadline-readiness"
      );
      const html = meetingRoomHtml({
        date: data.date,
        disabled: true,
        script: `
          document.querySelector('[data-day] button').addEventListener("click", () => {
            setTimeout(() => {
              document.querySelector("#reservation-continue").disabled = false;
            }, 150);
          });
        `,
      });

      // The first poll sees a disabled action; the 250 ms poll lands after this
      // 100 ms deadline and must make the function's final readiness check.
      await expect(
        prepareOn(html, withWaits(toReservationSelectionPreparation(data), 100))
      ).resolves.toBe("about:blank");
    }
  );

  test.skipIf(!chromiumAvailable)(
    "retries the selected meeting-room price at most once",
    async () => {
      const data = meetingRoomData(
        "2099-09-04T10:00",
        oneHour,
        "meeting-room-price-retry"
      );
      const html = meetingRoomHtml({
        date: data.date,
        disabled: true,
        extraMarkup: `<button id="reservation-advertised-price-retry" type="button"></button>`,
        script: `
          window.retryCount = 0;
          document.querySelector("#reservation-advertised-price-retry")
            .addEventListener("click", () => window.retryCount++);
        `,
      });

      await expect(
        prepareOn(html, withWaits(toReservationSelectionPreparation(data), 600))
      ).rejects.toThrow(
        "meeting-room availability or advertised price did not become ready"
      );
      await expect(
        getPage().evaluate(
          () => (window as typeof window & { retryCount: number }).retryCount
        )
      ).resolves.toBe(1);
    }
  );

  test.skipIf(!chromiumAvailable)(
    "waits for the meeting-room calendar to render the next month",
    async () => {
      const data = meetingRoomData(
        "2099-10-01T10:00",
        oneHour,
        "meeting-room-next-month"
      );
      const html = meetingRoomHtml({
        date: data.date,
        initialDate: "2099-09-30",
        visibleDate: "2099-09-30",
        extraMarkup: `<button aria-label="Go to the Next Month" type="button"></button>`,
        script: `
          document.querySelector('[aria-label="Go to the Next Month"]').addEventListener("click", (event) => {
            event.currentTarget.remove();
            setTimeout(() => {
              const day = document.createElement("div");
              day.dataset.day = "2099-10-01";
              day.innerHTML = '<button type="button"></button>';
              document.body.append(day);
            }, 150);
          });
        `,
      });

      await expect(
        prepareOn(
          html,
          withWaits(toReservationSelectionPreparation(data), 2_000)
        )
      ).resolves.toBe("about:blank");
      await expect(
        getPage().locator('input[name="startDateTime"]').inputValue()
      ).resolves.toBe("2099-10-01");
    }
  );

  test.skipIf(!chromiumAvailable)(
    "waits for the date-only meeting-room state before editing time",
    async () => {
      const data = meetingRoomData(
        "2099-10-02T10:00",
        fourHours,
        "meeting-room-date-before-time"
      );
      const html = meetingRoomHtml({
        date: data.date,
        initialDate: "2099-10-01",
        durationKey: "hour:4",
        dateUpdate: "none",
        script: `
          const hiddenStart = document.querySelector('input[name="startDateTime"]');
          const time = document.querySelector('input[aria-label="Meeting room start time"]');
          window.timeChangedBeforeDate = false;
          document.querySelector('[data-day] button').addEventListener("click", () => {
            queueMicrotask(() => {
              hiddenStart.value = "2099-10-02";
            });
          });
          time.addEventListener("change", () => {
            if (hiddenStart.value !== "2099-10-02") window.timeChangedBeforeDate = true;
          });
        `,
      });

      await expect(
        prepareOn(
          html,
          withWaits(toReservationSelectionPreparation(data), 2_000)
        )
      ).resolves.toBe("about:blank");
      await expect(
        getPage().evaluate(() => ({
          date: document.querySelector<HTMLInputElement>(
            'input[name="startDateTime"]'
          )?.value,
          time: document.querySelector<HTMLInputElement>(
            'input[aria-label="Meeting room start time"]'
          )?.value,
          timeChangedBeforeDate: (
            window as typeof window & { timeChangedBeforeDate: boolean }
          ).timeChangedBeforeDate,
        }))
      ).resolves.toEqual({
        date: "2099-10-02",
        time: "10:00",
        timeChangedBeforeDate: false,
      });
    }
  );

  test.skipIf(!chromiumAvailable)(
    "follows the current meeting-room duration control after rerender",
    async () => {
      const data = meetingRoomData(
        "2099-10-03T10:00",
        fourHours,
        "meeting-room-duration-rerender"
      );
      const html = meetingRoomHtml({
        date: data.date,
        durationKey: "hour:4",
        durationControl: `
          <label id="duration-label">
            <input id="meeting-room-duration-hour:4" type="radio" value="hour:4" />
          </label>
        `,
        script: `
          document.querySelector("#duration-label").addEventListener("click", (event) => {
            event.preventDefault();
            const replacement = document.createElement("input");
            replacement.id = "meeting-room-duration-hour:4";
            replacement.type = "radio";
            replacement.value = "hour:4";
            replacement.checked = true;
            document.querySelector('[id="meeting-room-duration-hour:4"]').replaceWith(replacement);
          });
        `,
      });

      await expect(
        prepareOn(
          html,
          withWaits(toReservationSelectionPreparation(data), 2_000)
        )
      ).resolves.toBe("about:blank");
      await expect(
        getPage().locator('[id="meeting-room-duration-hour:4"]').isChecked()
      ).resolves.toBe(true);
    }
  );
});

describe("office reservation preparation in Chromium", () => {
  test.skipIf(!chromiumAvailable)(
    "prepares a multi-day office reservation with selected seats",
    async () => {
      const data = makeOfficeCheckoutData(origin, officeSlot);
      const html = `
        <form>
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
        </form>
        <script>
          document.addEventListener("click", (event) => {
            const target = event.target;
            const button = target instanceof Element ? target.closest("[data-day] button") : null;
            const date = button?.closest("[data-day]")?.getAttribute("data-day");
            if (!date) return;
            const startsOn = document.querySelector('input[name="startsOn"]');
            const action = document.querySelector("#reservation-continue");
            startsOn.value = date;
            action.dataset.reservationPriceLoading = "true";
            setTimeout(() => {
              action.dataset.reservationPriceLoading = "false";
            }, 50);
          });
        </script>
      `;
      await expect(
        prepareOn(
          html,
          withWaits(toReservationSelectionPreparation(data), 2_000)
        )
      ).resolves.toBe("about:blank");
      await expect(
        getPage().evaluate(() => ({
          dayCount: document.querySelector<HTMLInputElement>(
            'input[name="dayCount"]'
          )?.value,
          email: document.querySelector<HTMLInputElement>('input[name="email"]')
            ?.value,
          seats: document.querySelector<HTMLInputElement>(
            'input[name="seats"]:checked'
          )?.value,
        }))
      ).resolves.toEqual({ dayCount: "2", email: "", seats: "2" });
    }
  );
});

describe("cowork reservation preparation in Chromium", () => {
  const reservedDeskData = makeCoworkCheckoutData(
    origin,
    "2099-09-01",
    "calendar-pricing-change",
    { entryTier: "reserved-desk", monitorOption: "2x27-qhd" }
  );

  test.skipIf(!chromiumAvailable)(
    "prepares the Reserved Desk price and monitor without another tier",
    async () => {
      const html = `
        <input name="date" value="2099-09-01" />
        <button data-reservation-type-price="reserved-desk" data-reservation-type-price-ready="false"></button>
        <input id="reservation-entry-tier-reserved-desk" type="radio" checked />
        <label id="monitor"><input type="radio" value="2x27-qhd" /></label>
        <script>
          const price = document.querySelector('[data-reservation-type-price="reserved-desk"]');
          const tier = document.querySelector("#reservation-entry-tier-reserved-desk");
          const monitor = document.querySelector('input[value="2x27-qhd"]');
          price.addEventListener("click", () => {
            tier.checked = true;
            monitor.checked = false;
            price.dataset.reservationTypePriceReady = "false";
          });
          document.querySelector("#monitor").addEventListener("click", (event) => {
            event.preventDefault();
            monitor.checked = true;
            price.dataset.reservationTypePriceReady = "true";
          });
        </script>
      `;

      await expect(
        prepareOn(
          html,
          withWaits(toReservationSelectionPreparation(reservedDeskData), 2_000)
        )
      ).resolves.toBe("about:blank");
      await expect(
        getPage().evaluate(() => ({
          monitor: document.querySelector<HTMLInputElement>(
            'input[value="2x27-qhd"]'
          )?.checked,
          ready: document.querySelector<HTMLElement>(
            '[data-reservation-type-price="reserved-desk"]'
          )?.dataset.reservationTypePriceReady,
          tier: document.querySelector<HTMLInputElement>(
            "#reservation-entry-tier-reserved-desk"
          )?.checked,
        }))
      ).resolves.toEqual({ monitor: true, ready: "true", tier: true });
    }
  );

  test.skipIf(!chromiumAvailable)(
    "selects a monitor over a page-loaded Reserved Desk price",
    async () => {
      const html = `
        <input name="date" value="2099-09-01" />
        <button data-reservation-type-price="reserved-desk" data-reservation-type-price-ready="true"></button>
        <input id="reservation-entry-tier-reserved-desk" type="radio" checked />
        <label><input type="radio" value="2x27-qhd" /></label>
      `;

      await prepareOn(
        html,
        withWaits(toReservationSelectionPreparation(reservedDeskData))
      );
      await expect(
        getPage().locator('input[value="2x27-qhd"]').isChecked()
      ).resolves.toBe(true);
    }
  );

  test.skipIf(!chromiumAvailable)(
    "turns the workstation on before choosing a monitor",
    async () => {
      const html = `
        <input name="date" value="2099-09-01" />
        <button data-reservation-type-price="reserved-desk" data-reservation-type-price-ready="true"></button>
        <input id="reservation-entry-tier-reserved-desk" type="radio" checked />
        <div data-cowork-optional-addon-toggle="workstation">
          <button role="switch" aria-checked="false" type="button"></button>
        </div>
        <script>
          const workstation = document.querySelector('[role="switch"]');
          workstation.addEventListener("click", () => {
            workstation.setAttribute("aria-checked", "true");
            document.body.insertAdjacentHTML(
              "beforeend",
              '<label><input type="radio" value="2x27-qhd" checked /></label>' +
                '<label><input type="radio" value="2x32-qhd" /></label>'
            );
          });
        </script>
      `;

      const data = makeCoworkCheckoutData(
        origin,
        "2099-09-01",
        "url-state-cowork",
        { entryTier: "reserved-desk", monitorOption: "2x32-qhd" }
      );
      await prepareOn(html, withWaits(toReservationSelectionPreparation(data)));
      await expect(
        getPage().evaluate(() => ({
          monitor: document.querySelector<HTMLInputElement>(
            'input[value="2x32-qhd"]'
          )?.checked,
          workstation: document
            .querySelector('[role="switch"]')
            ?.getAttribute("aria-checked"),
        }))
      ).resolves.toEqual({ monitor: true, workstation: "true" });
    }
  );

  test.skipIf(!chromiumAvailable)(
    "accepts an already-prepared prefilled Reserved Desk price",
    async () => {
      const html = `
        <input name="date" value="2099-09-01" />
        <button data-reservation-type-price="reserved-desk" data-reservation-type-price-ready="true"></button>
        <input id="reservation-entry-tier-reserved-desk" type="radio" checked />
        <label><input type="radio" value="2x27-qhd" checked /></label>
      `;

      await expect(
        prepareOn(
          html,
          withWaits(toReservationSelectionPreparation(reservedDeskData))
        )
      ).resolves.toBe("about:blank");
    }
  );

  const editedDateHtml = (refreshesPrice: boolean) => `
    <button aria-haspopup="dialog" type="button"></button>
    <div data-day="2099-10-02"><button type="button"></button></div>
    <input name="date" value="2099-10-01" />
    <button data-reservation-type-price="open-space" data-reservation-type-price-ready="true"></button>
    <input id="reservation-entry-tier-open-space" type="radio" checked />
    <script>
      const date = document.querySelector('input[name="date"]');
      const price = document.querySelector('[data-reservation-type-price="open-space"]');
      document.querySelector('[data-day="2099-10-02"] button').addEventListener("click", () => {
        date.value = "2099-10-02";
        if (!${refreshesPrice}) return;
        price.dataset.reservationTypePriceReady = "false";
        setTimeout(() => {
          price.dataset.reservationTypePriceReady = "true";
        }, 50);
      });
    </script>
  `;

  const editedDateData = makeCoworkCheckoutData(
    origin,
    "2099-10-02",
    "cowork-reservation-replacement"
  );

  test.skipIf(!chromiumAvailable)(
    "selects an edited cowork date and waits for its advertised price",
    async () => {
      await prepareOn(
        editedDateHtml(true),
        withWaits(toReservationSelectionPreparation(editedDateData), 2_000)
      );
      await expect(
        getPage().evaluate(() => ({
          date: document.querySelector<HTMLInputElement>('input[name="date"]')
            ?.value,
          ready: document.querySelector<HTMLElement>(
            '[data-reservation-type-price="open-space"]'
          )?.dataset.reservationTypePriceReady,
        }))
      ).resolves.toEqual({ date: "2099-10-02", ready: "true" });
    }
  );

  test.skipIf(!chromiumAvailable)(
    "fails when an edited cowork date never refreshes its advertised price",
    async () => {
      await expect(
        prepareOn(
          editedDateHtml(false),
          withWaits(toReservationSelectionPreparation(editedDateData), 600)
        )
      ).rejects.toThrow(
        "advertised price did not refresh after date selection"
      );
    }
  );
});

describe("reservation step composition in Chromium", () => {
  const data = makeCoworkCheckoutData(origin, "2099-09-01", "step-composition");

  test.skipIf(!chromiumAvailable)(
    "selects on the selection step, waits for Continue, and leaves contact blank",
    async () => {
      const html = `
        <form>
          <div hidden>
            <input name="name" />
            <input name="email" />
            <input name="emailConfirmation" />
            <input name="phone" />
          </div>
          <input name="date" value="2099-09-01" />
          <button type="button" data-reservation-type-price="open-space" data-reservation-type-price-ready="true"></button>
          <input id="reservation-entry-tier-open-space" type="radio" checked />
          <button id="reservation-continue" type="button" disabled></button>
        </form>
        <script>
          setTimeout(() => {
            document.querySelector("#reservation-continue").disabled = false;
          }, 350);
        </script>
      `;
      await expect(
        prepareOn(html, withWaits(toReservationStep(data), 1_500, 1_500))
      ).resolves.toBe("about:blank");
      await expect(
        getPage().evaluate(() =>
          [
            ...document.querySelectorAll<HTMLInputElement>(
              'input[name="name"], input[name="email"], input[name="emailConfirmation"], input[name="phone"]'
            ),
          ].map((input) => input.value)
        )
      ).resolves.toEqual(["", "", "", ""]);
    }
  );

  test.skipIf(!chromiumAvailable)(
    "fills contact on the contact step and waits for Submit",
    async () => {
      const html = `
        <form>
          <input name="name" />
          <input name="email" />
          <input name="emailConfirmation" />
          <input name="phone" />
          <button id="reservation-submit" type="submit" disabled></button>
        </form>
        <script>
          window.submitEvents = 0;
          document.querySelector("form").addEventListener("submit", (event) => {
            event.preventDefault();
            window.submitEvents++;
          });
          setTimeout(() => {
            document.querySelector("#reservation-submit").disabled = false;
          }, 350);
        </script>
      `;
      await expect(
        prepareOn(html, withWaits(toReservationStep(data), 1_500, 1_500))
      ).resolves.toBe("about:blank");
      await expect(
        getPage().evaluate(() => ({
          name: document.querySelector<HTMLInputElement>('input[name="name"]')
            ?.value,
          email: document.querySelector<HTMLInputElement>('input[name="email"]')
            ?.value,
          confirmation: document.querySelector<HTMLInputElement>(
            'input[name="emailConfirmation"]'
          )?.value,
          phone: document.querySelector<HTMLInputElement>('input[name="phone"]')
            ?.value,
          submitEvents: (window as typeof window & { submitEvents: number })
            .submitEvents,
        }))
      ).resolves.toEqual({
        name: data.name,
        email: data.email,
        confirmation: data.email,
        phone: data.phone,
        submitEvents: 0,
      });
    }
  );

  test.skipIf(!chromiumAvailable)(
    "waits for Submit after contact input disables and re-enables it",
    async () => {
      const html = `
        <form>
          <input name="name" />
          <input name="email" />
          <input name="emailConfirmation" />
          <input name="phone" />
          <button id="reservation-submit" type="submit"></button>
        </form>
        <script>
          const submit = document.querySelector("#reservation-submit");
          window.submitEnabledAgain = false;
          document.querySelector('input[name="name"]').addEventListener("input", () => {
            queueMicrotask(() => {
              Promise.resolve().then(() => {
                submit.disabled = true;
                setTimeout(() => {
                  submit.disabled = false;
                  window.submitEnabledAgain = true;
                }, 500);
              });
            });
          });
        </script>
      `;
      await expect(
        prepareOn(html, withWaits(toReservationStep(data), 1_000, 1_500))
      ).resolves.toBe("about:blank");
      await expect(
        getPage().evaluate(() => ({
          enabledAgain: (
            window as typeof window & { submitEnabledAgain: boolean }
          ).submitEnabledAgain,
          submitDisabled: document.querySelector<HTMLButtonElement>(
            "#reservation-submit"
          )?.disabled,
        }))
      ).resolves.toEqual({ enabledAgain: true, submitDisabled: false });
    }
  );

  test.skipIf(!chromiumAvailable)(
    "fills only rendered editable contact inputs, including confirmation",
    async () => {
      const html = `
        <form>
          <div hidden><input name="date" /></div>
          <input name="name" />
          <input name="email" />
          <input name="emailConfirmation" />
          <input name="phone" />
          <button id="reservation-submit" type="submit"></button>
        </form>
      `;
      await prepareOn(html, withWaits(toReservationStep(data)));
      await expect(
        getPage().evaluate(() => ({
          name: document.querySelector<HTMLInputElement>('input[name="name"]')
            ?.value,
          email: document.querySelector<HTMLInputElement>('input[name="email"]')
            ?.value,
          confirmation: document.querySelector<HTMLInputElement>(
            'input[name="emailConfirmation"]'
          )?.value,
          phone: document.querySelector<HTMLInputElement>('input[name="phone"]')
            ?.value,
        }))
      ).resolves.toEqual({
        name: data.name,
        email: data.email,
        confirmation: data.email,
        phone: data.phone,
      });

      await getPage().setContent(`
        <form>
          <input name="name" />
          <input name="email" readonly value="${testEmailAddress("account")}" />
          <input name="phone" />
          <button id="reservation-submit" type="submit"></button>
        </form>
      `);
      await getPage().evaluate(prepareReservationForm, {
        preparation: withWaits(toReservationStep(data)),
      });
      await expect(
        getPage().evaluate(() => ({
          name: document.querySelector<HTMLInputElement>('input[name="name"]')
            ?.value,
          email: document.querySelector<HTMLInputElement>('input[name="email"]')
            ?.value,
          phone: document.querySelector<HTMLInputElement>('input[name="phone"]')
            ?.value,
        }))
      ).resolves.toEqual({
        name: data.name,
        email: testEmailAddress("account"),
        phone: data.phone,
      });

      await getPage().setContent(`
        <form>
          <section aria-labelledby="reservation-existing-customer-heading"></section>
          <button id="reservation-submit" type="submit"></button>
        </form>
      `);
      await expect(
        getPage().evaluate(prepareReservationForm, {
          preparation: withWaits(toReservationStep(data)),
        })
      ).resolves.toBe("about:blank");
    }
  );

  for (const family of ["cowork", "meeting-room", "office"] as const) {
    test.skipIf(!chromiumAvailable)(
      `prepared ${family} reservation only waits and never submits`,
      async () => {
        const html = `
          <form>
            <button id="reservation-submit" type="submit" disabled></button>
          </form>
          <script>
            window.clickEvents = 0;
            window.submitEvents = 0;
            const action = document.querySelector("#reservation-submit");
            action.addEventListener("click", () => window.clickEvents++);
            document.querySelector("form").addEventListener("submit", (event) => {
              event.preventDefault();
              window.submitEvents++;
            });
            setTimeout(() => {
              action.disabled = false;
            }, 250);
          </script>
        `;
        await expect(
          prepareOn(html, withWaits(preparedReservationForm, 1_500))
        ).resolves.toBe("about:blank");
        await expect(
          getPage().evaluate(() => ({
            clickEvents: (window as typeof window & { clickEvents: number })
              .clickEvents,
            submitEvents: (window as typeof window & { submitEvents: number })
              .submitEvents,
          }))
        ).resolves.toEqual({ clickEvents: 0, submitEvents: 0 });
      }
    );
  }

  test.skipIf(!chromiumAvailable)(
    "reports a disabled action and a missing action at the action deadline",
    async () => {
      await expect(
        prepareOn(
          `<form><button id="reservation-submit" type="submit" disabled></button></form>`,
          withWaits(preparedReservationForm, 400, 400)
        )
      ).rejects.toThrow(
        "reservation reservation-submit button stayed disabled"
      );

      await expect(
        prepareOn(`<form></form>`, withWaits(preparedReservationForm, 400, 400))
      ).rejects.toThrow("reservation continue or submit button not found");
    }
  );
});

describe("detached reservation preparation in Chromium", () => {
  test.skipIf(!chromiumAvailable)(
    "returns immediately, records pending then ready, and never submits",
    async () => {
      const html = `
        <form>
          <button id="reservation-submit" type="submit" disabled></button>
        </form>
        <script>
          window.submitEvents = 0;
          document.querySelector("form").addEventListener("submit", (event) => {
            event.preventDefault();
            window.submitEvents++;
          });
          setTimeout(() => {
            document.querySelector("#reservation-submit").disabled = false;
          }, 1_500);
        </script>
      `;
      const currentPage = getPage();
      await currentPage.setContent(html);
      await expect(
        currentPage.evaluate(prepareReservationForm, {
          preparation: withWaits(preparedReservationForm, 1_500, 4_000),
          detachInto: "detachedPreparation",
        })
      ).resolves.toBe(true);
      await expect(
        currentPage.evaluate(
          readReservationPreparationState,
          "detachedPreparation"
        )
      ).resolves.toEqual({ status: "pending" });

      const becameReady = await currentPage
        .waitForFunction(
          (key) => {
            const state = (
              globalThis as typeof globalThis & {
                [name: string]: { status?: string } | undefined;
              }
            )[key];
            return state?.status === "ready" || state?.status === "failed";
          },
          "detachedPreparation",
          { timeout: 5_000 }
        )
        .then(
          () => true,
          () => false
        );
      const state = await currentPage.evaluate(
        readReservationPreparationState,
        "detachedPreparation"
      );
      expect({ becameReady, state }).toEqual({
        becameReady: true,
        state: { status: "ready" },
      });
      await expect(
        currentPage.evaluate(
          () =>
            (window as typeof window & { submitEvents: number }).submitEvents
        )
      ).resolves.toBe(0);
    }
  );

  test.skipIf(!chromiumAvailable)(
    "records failures with their message truncated to 500 characters",
    async () => {
      const tier = "x".repeat(600);
      const preparation = {
        kind: "selection",
        selection: {
          date: "2099-09-01",
          kind: "cowork",
          monitorOption: null,
          tier,
          waitTimeoutMs: 1_000,
        },
      } as const satisfies ReservationFormPreparation;
      const currentPage = getPage();
      await currentPage.setContent("<form></form>");
      await expect(
        currentPage.evaluate(prepareReservationForm, {
          preparation,
          detachInto: "failedPreparation",
        })
      ).resolves.toBe(true);
      await currentPage.waitForFunction(
        (key) => {
          const state = (
            globalThis as typeof globalThis & {
              [name: string]: { status?: string } | undefined;
            }
          )[key];
          return state?.status === "failed";
        },
        "failedPreparation",
        { timeout: 2_000 }
      );
      const state = (await currentPage.evaluate(
        readReservationPreparationState,
        "failedPreparation"
      )) as { status: string; error?: string };
      expect(state.status).toBe("failed");
      expect(state.error).toHaveLength(500);
      expect(state.error?.startsWith(tier.slice(0, 500))).toBe(true);
    }
  );
});

describe("reservation preparation builders", () => {
  test("requires matching room and office data", () => {
    const cowork = makeCoworkCheckoutData(origin, "2099-09-01");
    const missingRoom = {
      ...cowork,
      expectedReservationDetails: { kind: "meeting-room" } as never,
      meetingRoom: undefined,
    } satisfies CheckoutData;
    const missingOffice = {
      ...cowork,
      expectedReservationDetails: { kind: "office" } as never,
      office: undefined,
    } satisfies CheckoutData;

    expect(() => toReservationSelection(missingRoom)).toThrow(
      "Meeting-room reservation submission requires room data"
    );
    expect(() => toReservationStep(missingRoom)).toThrow(
      "Meeting-room reservation submission requires room data"
    );
    expect(() => toReservationSelection(missingOffice)).toThrow(
      "Office reservation submission requires office data"
    );
    expect(() => toReservationStep(missingOffice)).toThrow(
      "Office reservation submission requires office data"
    );
  });
});
