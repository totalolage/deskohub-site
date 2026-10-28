import "../../shared/polyfills/temporal";

import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { type Browser, chromium, type Page } from "@playwright/test";
import { Effect } from "effect";
import type { MeetingRoomReservationDuration } from "@/features/reservation/meeting-room-reservation-duration";
import { getMeetingRoomReservationInterval } from "@/features/reservation/meeting-room-reservation-time";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { waitForBrowserCondition } from "../browser";
import { getPrefilledReservationConditionScript } from "../browser-scripts";
import { browserSessionFor, makePlaywrightBrowserRunner } from "../runtime";
import type { CheckoutData } from "../types";
import {
  makeCoworkCheckoutData,
  makeMeetingRoomCheckoutData,
  makeOfficeCheckoutData,
  type OfficeCheckoutSlot,
} from "./data";
import {
  isPrefilledReservation,
  type PrefilledReservationOptions,
  toPrefilledReservation,
} from "./prefilled-reservation";

const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;
let page: Page | undefined;

beforeAll(async () => {
  if (!chromiumAvailable) return;
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
});

afterAll(async () => {
  await browser?.close();
});

const origin = "https://workspace.example.test";

/** Whether the in-page check accepts `html` as `data` restored. */
const isPrefilledOn = async (
  html: string,
  data: CheckoutData,
  options: PrefilledReservationOptions = {}
) => {
  if (!page) throw new Error("Chromium is not running");
  await page.setContent(html);
  return page.evaluate(
    isPrefilledReservation,
    toPrefilledReservation(data, options)
  );
};

const meetingRoomData = (
  startDateTime: string,
  duration: MeetingRoomReservationDuration,
  scenario: string
) => {
  const interval = getMeetingRoomReservationInterval(startDateTime, duration);
  if (!interval) throw new Error("meeting-room interval missing");
  return makeMeetingRoomCheckoutData(
    origin,
    {
      date: startDateTime.slice(0, 10),
      duration,
      startDateTime,
      ...interval,
    },
    scenario
  );
};

const contactHtml = (
  data: CheckoutData,
  {
    consent = '<button id="reservation-marketing-consent" aria-checked="false"></button>',
    emailConfirmation = "",
  }: { readonly consent?: string; readonly emailConfirmation?: string } = {}
) => `
  <input name="email" value="${data.email}" />
  <input name="phone" value="${data.phone}" />
  <input name="name" value="${data.name}" />
  ${emailConfirmation}
  ${consent}`;

test.skipIf(!chromiumAvailable)(
  "checks restored whole-day meeting-room state and reset marketing consent",
  async () => {
    const data = meetingRoomData(
      "2099-09-01T00:00",
      { unit: "day", amount: 1 },
      "meeting-room-backfill"
    );
    const selection = (time = "", duration = "day:1") => `
      <input name="startDateTime" value="2099-09-01" />
      ${time}
      <input id="meeting-room-duration-${duration}" type="radio" value="${duration}" checked />`;

    expect(await isPrefilledOn(selection() + contactHtml(data), data)).toBe(
      true
    );
    // A whole day hides the start time.
    expect(
      await isPrefilledOn(
        selection('<input type="time" value="00:00" />') + contactHtml(data),
        data
      )
    ).toBe(false);
    expect(
      await isPrefilledOn(selection("", "hour:1") + contactHtml(data), data)
    ).toBe(false);
    expect(
      await isPrefilledOn(
        selection() +
          contactHtml(data, {
            consent:
              '<button id="reservation-marketing-consent" aria-checked="true"></button>',
          }),
        data
      )
    ).toBe(false);
    expect(
      await isPrefilledOn(
        selection() +
          contactHtml(data, {
            consent: '<div id="reservation-marketing-consent"></div>',
          }),
        data
      )
    ).toBe(false);
  }
);

test.skipIf(!chromiumAvailable)(
  "checks meeting-room prefills without locale-specific labels",
  async () => {
    const data = meetingRoomData(
      "2099-09-01T10:00",
      { unit: "hour", amount: 1 },
      "meeting-room-prefill"
    );
    const selection = (time: string) => `
      <input name="startDateTime" value="2099-09-01" />
      ${time}
      <input id="meeting-room-duration-hour:1" type="radio" value="hour:1" checked />`;
    const czechTime = (value: string) =>
      `<input type="time" value="${value}" aria-label="Začátek rezervace" />`;

    expect(
      await isPrefilledOn(
        selection(czechTime("10:00")) + contactHtml(data),
        data
      )
    ).toBe(true);
    expect(
      await isPrefilledOn(
        selection(czechTime("11:00")) + contactHtml(data),
        data
      )
    ).toBe(false);
    expect(await isPrefilledOn(selection("") + contactHtml(data), data)).toBe(
      false
    );
  }
);

test.skipIf(!chromiumAvailable)(
  "checks restored cowork switches and monitor options for both current offers",
  async () => {
    const openSpace = makeCoworkCheckoutData(
      origin,
      "2099-09-01",
      "cowork-prefill-open-space",
      { coffee: true }
    );
    const coffeeSwitch = (checked: boolean) => `
      <label id="reservation-coffee-label">Coffee
        <button aria-checked="${checked}" aria-labelledby="reservation-coffee-label" role="switch"></button>
      </label>`;
    const cowork = (
      data: CheckoutData,
      switchHtml: string,
      monitorHtml: string,
      { date = data.date, entryTier = "" } = {}
    ) => `
      <input checked name="entryTier" type="radio" value="${entryTier || (data.expectedReservationDetails.kind === "cowork" ? data.expectedReservationDetails.entryTier : "")}" />
      <input name="date" type="hidden" value="${date}" />
      ${switchHtml}
      ${contactHtml(data)}
      ${monitorHtml}`;

    expect(
      await isPrefilledOn(cowork(openSpace, coffeeSwitch(true), ""), openSpace)
    ).toBe(true);
    expect(
      await isPrefilledOn(cowork(openSpace, coffeeSwitch(false), ""), openSpace)
    ).toBe(false);
    expect(
      await isPrefilledOn(
        cowork(openSpace, coffeeSwitch(true), "", { date: "2099-09-02" }),
        openSpace
      )
    ).toBe(false);
    expect(
      await isPrefilledOn(
        cowork(openSpace, coffeeSwitch(true), "", {
          entryTier: "reserved-desk",
        }),
        openSpace
      )
    ).toBe(false);
    // Open Space offers no monitor.
    expect(
      await isPrefilledOn(
        cowork(
          openSpace,
          coffeeSwitch(true),
          '<input name="monitorOption" type="radio" value="2x27-qhd" />'
        ),
        openSpace
      )
    ).toBe(false);

    const reservedDesk = makeCoworkCheckoutData(
      origin,
      "2099-09-01",
      "cowork-prefill-reserved-desk",
      { entryTier: "reserved-desk", monitorOption: "2x27-qhd" }
    );
    const workstationSwitch = (checked: boolean) => `
      <label id="reservation-workstation-label">Monitor workstation
        <button aria-checked="${checked}" aria-labelledby="reservation-workstation-label" role="switch"></button>
      </label>`;
    const monitor = (value: string, checked = true) =>
      `<input ${checked ? "checked" : ""} name="monitorOption" type="radio" value="${value}" />`;

    expect(
      await isPrefilledOn(
        cowork(reservedDesk, workstationSwitch(true), monitor("2x27-qhd")),
        reservedDesk
      )
    ).toBe(true);
    expect(
      await isPrefilledOn(
        cowork(reservedDesk, workstationSwitch(false), monitor("2x27-qhd")),
        reservedDesk
      )
    ).toBe(false);
    expect(
      await isPrefilledOn(
        cowork(
          reservedDesk,
          workstationSwitch(true),
          monitor("2x27-qhd", false)
        ),
        reservedDesk
      )
    ).toBe(false);
    expect(
      await isPrefilledOn(
        cowork(reservedDesk, workstationSwitch(true), monitor("1x27-qhd")),
        reservedDesk
      )
    ).toBe(false);
  }
);

const officeSlot: OfficeCheckoutSlot = {
  endsAt: "2099-09-02T22:00:00Z" as OfficeCheckoutSlot["endsAt"],
  endsOn: "2099-09-02",
  seats: 2,
  startsAt: "2099-08-31T22:00:00Z" as OfficeCheckoutSlot["startsAt"],
  startsOn: "2099-09-01",
};

test.skipIf(!chromiumAvailable)(
  "checks restored office range, seats, and contact only when carried in",
  async () => {
    const data = makeOfficeCheckoutData(origin, officeSlot);
    const selection = ({ dayCount = "2", seats = "2" } = {}) => `
      <input name="startsOn" value="2099-09-01" />
      <input name="dayCount" type="number" value="${dayCount}" />
      <input checked name="seats" type="radio" value="${seats}" />`;
    const otherContact = makeOfficeCheckoutData(
      origin,
      officeSlot,
      "office-other-contact"
    );

    expect(await isPrefilledOn(selection() + contactHtml(data), data)).toBe(
      true
    );
    expect(
      await isPrefilledOn(
        selection({ dayCount: "3" }) + contactHtml(data),
        data
      )
    ).toBe(false);
    expect(
      await isPrefilledOn(selection({ seats: "1" }) + contactHtml(data), data)
    ).toBe(false);

    // A selection link carries no contact, so another contact and checked
    // consent pass only when the contact is not expected.
    const linked =
      selection() +
      contactHtml(otherContact, {
        consent:
          '<button id="reservation-marketing-consent" aria-checked="true"></button>',
      });
    expect(await isPrefilledOn(linked, data)).toBe(false);
    expect(await isPrefilledOn(linked, data, { includeContact: false })).toBe(
      true
    );
    expect(
      await isPrefilledOn(selection(), data, { includeContact: false })
    ).toBe(true);

    // Booking for someone else repeats the email.
    const repeated = (value: string) =>
      selection() +
      contactHtml(data, {
        emailConfirmation: `<input name="emailConfirmation" value="${value}" />`,
      });
    expect(await isPrefilledOn(repeated(data.email), data)).toBe(true);
    expect(await isPrefilledOn(repeated(otherContact.email), data)).toBe(false);
  }
);

test.skipIf(!chromiumAvailable)(
  "runs the same check as the argv condition for callers on the argv runner",
  async () => {
    if (!browser) throw new Error("Chromium is not running");
    const data = meetingRoomData(
      "2099-09-01T10:00",
      { unit: "hour", amount: 1 },
      "meeting-room-argv"
    );
    const html = `
      <input name="startDateTime" value="2099-09-01" />
      <input type="time" value="10:00" />
      <input id="meeting-room-duration-hour:1" type="radio" value="hour:1" checked />
      ${contactHtml(data)}`;
    const run = makePlaywrightBrowserRunner(browser, { recordHar: false });
    const id = `prefilled-argv-${randomUUID()}`;
    try {
      const outcome = await Effect.runPromise(
        Effect.gen(function* () {
          const session = yield* browserSessionFor(run, id);
          yield* session.use("show the page", (shown) =>
            shown.setContent(html)
          );
          const matching = yield* Effect.exit(
            waitForBrowserCondition(
              run,
              id,
              "prefilled reservation fields",
              getPrefilledReservationConditionScript(data),
              { timeoutMs: 2000 }
            )
          );
          const other = meetingRoomData(
            "2099-09-01T11:00",
            { unit: "hour", amount: 1 },
            "meeting-room-argv"
          );
          const mismatching = yield* Effect.exit(
            waitForBrowserCondition(
              run,
              id,
              "prefilled reservation fields",
              getPrefilledReservationConditionScript(other),
              { timeoutMs: 500 }
            )
          );
          return { matching: matching._tag, mismatching: mismatching._tag };
        })
      );
      expect(outcome).toEqual({ matching: "Success", mismatching: "Failure" });
    } finally {
      await run.close?.();
    }
  }
);
