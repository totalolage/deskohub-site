import "../../shared/polyfills/temporal";

import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "@playwright/test";
import { getMeetingRoomReservationInterval } from "@/features/reservation/meeting-room-reservation-time";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import type { CheckoutData } from "../types";
import {
  makeCoworkCheckoutData,
  makeMeetingRoomCheckoutData,
  makeOfficeCheckoutData,
} from "./data";
import {
  findRepeatReservationProblem,
  toRepeatReservation,
} from "./repeat-reservation";

const chromiumAvailable = await playwrightChromiumAvailable();
const origin = "https://workspace.example.test";
let browser: Browser | undefined;
let page: Page | undefined;
let html = "";

beforeAll(async () => {
  if (!chromiumAvailable) return;
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  // The check reads the query string, so every page is served from the
  // Workspace origin.
  await page.route(`${origin}/**`, (route) =>
    route.fulfill({ body: html, contentType: "text/html" })
  );
});

afterAll(async () => {
  await browser?.close();
});

const emptyContact = `
  <input name="email" value="" />
  <input name="phone" value="" />
  <input name="name" value="" />
  <textarea name="message"></textarea>
  <button id="reservation-marketing-consent" aria-checked="false"></button>`;

/** The problem the in-page check reports for `body` at `path`. */
const problemAt = async (path: string, body: string, data: CheckoutData) => {
  if (!page) throw new Error("Chromium is not running");
  html = body;
  await page.goto(`${origin}${path}`);
  return page.evaluate(findRepeatReservationProblem, toRepeatReservation(data));
};

const openSpaceData = makeCoworkCheckoutData(
  origin,
  "2099-09-01",
  "cowork-repeat-open-space"
);
const openSpacePath =
  "/en-US/reservation/cowork?entryTier=open-space&coffee=false";
const openSpaceHtml = (date = "2099-08-27", coffee = "false") => `
  <input name="date" value="${date}" />
  <input checked name="entryTier" type="radio" value="open-space" />
  <label id="reservation-coffee-label">Coffee
    <button aria-checked="${coffee}" aria-labelledby="reservation-coffee-label" role="switch"></button>
  </label>`;

test.skipIf(!chromiumAvailable)(
  "accepts safe repeat-reservation defaults for every family",
  async () => {
    const meetingRoomInterval = getMeetingRoomReservationInterval(
      "2099-09-01T10:00",
      { unit: "hour", amount: 4 }
    );
    if (!meetingRoomInterval) throw new Error("meeting-room interval missing");
    const scenarios = [
      {
        data: openSpaceData,
        html: openSpaceHtml(),
        path: openSpacePath,
      },
      {
        data: makeCoworkCheckoutData(
          origin,
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
          <input checked name="monitorOption" type="radio" value="2x27-qhd" />`,
        path: "/en-US/reservation/cowork?entryTier=reserved-desk&coffee=true&monitorOption=2x27-qhd",
      },
      {
        data: makeMeetingRoomCheckoutData(
          origin,
          {
            date: "2099-09-01",
            duration: { unit: "hour", amount: 4 },
            startDateTime: "2099-09-01T10:00",
            ...meetingRoomInterval,
          },
          "meeting-room-repeat"
        ),
        html: '<input name="startDateTime" value="2099-08-27" />',
        path: "/en-US/reservation/meeting-room",
      },
      {
        data: makeOfficeCheckoutData(origin, {
          endsAt: "2099-09-02T22:00:00Z" as never,
          endsOn: "2099-09-02",
          seats: 2,
          startsAt: "2099-08-31T22:00:00Z" as never,
          startsOn: "2099-09-01",
        }),
        html: `
          <input name="startsOn" value="2099-08-27" />
          <input name="dayCount" value="2" />
          <input checked name="seats" type="radio" value="2" />`,
        path: "/en-US/reservation/office?dayCount=2&seats=2",
      },
    ];

    for (const scenario of scenarios) {
      expect(
        await problemAt(
          scenario.path,
          scenario.html + emptyContact,
          scenario.data
        )
      ).toBeNull();
    }
  }
);

test.skipIf(!chromiumAvailable)(
  "names the first default that is not safe",
  async () => {
    const cases = [
      // An extra query parameter beyond the allowlist.
      {
        body: openSpaceHtml() + emptyContact,
        field: "query allowlist",
        path: `${openSpacePath}&date=2099-09-01`,
      },
      {
        body: openSpaceHtml("2099-09-01") + emptyContact,
        field: "fresh date",
        path: openSpacePath,
      },
      {
        body: openSpaceHtml(undefined, "true") + emptyContact,
        field: "coffee switch",
        path: openSpacePath,
      },
      {
        body:
          openSpaceHtml() +
          emptyContact.replace(
            'name="phone" value=""',
            'name="phone" value="1"'
          ),
        field: "phone reset",
        path: openSpacePath,
      },
      {
        body:
          openSpaceHtml() +
          emptyContact.replace('aria-checked="false"', 'aria-checked="true"'),
        field: "marketing consent reset",
        path: openSpacePath,
      },
    ];

    for (const { body, field, path } of cases) {
      expect(await problemAt(path, body, openSpaceData)).toBe(
        `repeat reservation ${field} did not match`
      );
    }
  }
);

test.skipIf(!chromiumAvailable)(
  "accepts a signed-in account form that renders no contact inputs",
  async () => {
    expect(
      await problemAt(openSpacePath, openSpaceHtml(), openSpaceData)
    ).toBeNull();
  }
);

test("needs the office range to describe an office repeat", () => {
  expect(() =>
    toRepeatReservation({
      ...openSpaceData,
      expectedReservationDetails: { kind: "office" } as never,
      office: undefined,
    })
  ).toThrow("Office repeat assertions require range data");
});
