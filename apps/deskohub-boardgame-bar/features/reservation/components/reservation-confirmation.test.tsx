import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import {
  renderOnLocaleRoute,
  routeLocale,
} from "@/features/gallery/components/gallery-render.test-utils";
import { m } from "@/features/i18n/paraglide/messages";
import { formatDurationMinutes } from "@/shared/utils/date-formatting";
import {
  ReservationConfirmation,
  type ReservationDetails,
  type ReservationStatus,
} from "./reservation-confirmation";

type ReservationType = "table" | "training-room";

const minimalDetails: ReservationDetails = {
  name: "Petr",
  email: undefined,
  phone: undefined,
  date: new Date("2026-11-21"),
  time: "09:00",
};

const completeDetails: ReservationDetails = {
  id: "R-42",
  name: "jana",
  email: "jana@example.test",
  phone: "+420 111 222 333",
  date: new Date("2026-11-20"),
  time: "18:00",
  durationMinutes: 90,
  guestCount: 4,
  specialRequests: "Near the window",
  tablePreference: "private",
};

const renderConfirmation = ({
  status = "submitted",
  type = "table",
  details = minimalDetails,
  customMessage,
}: {
  status?: ReservationStatus;
  type?: ReservationType;
  details?: ReservationDetails;
  customMessage?: ReactNode;
}) =>
  renderOnLocaleRoute(
    <ReservationConfirmation
      status={status}
      type={type}
      details={details}
      customMessage={customMessage}
    />
  );

/** Inner HTML of the first `tag` element whose opening tag matches `attributes`. */
const elementContent = (html: string, tag: string, attributes = "") =>
  html.match(
    new RegExp(`<${tag}[^>]*${attributes}[^>]*>(.*?)</${tag}>`, "s")
  )?.[1];

const heading = (html: string) => elementContent(html, "h1");
const statusMessage = (html: string) =>
  elementContent(html, "p", 'class="text-gray-600 text-lg"');
const statusIcon = (html: string) =>
  html.match(/<svg class="([^"]*)"[^>]*role="img"[^>]*><path[^>]* d="([^"]*)"/);

const statuses: ReservationStatus[] = ["submitted", "confirmed", "rejected"];
const separator = 'role="none"';

describe("ReservationConfirmation status header", () => {
  test.each([
    ["table", "submitted", m["reservationSubmitted.title"]()],
    ["table", "confirmed", m["thankYou.title"]()],
    ["table", "rejected", m["reservationRejected.title"]()],
    [
      "training-room",
      "submitted",
      m["trainingReservation.confirmation.title"](),
    ],
    ["training-room", "confirmed", m["thankYou.title"]()],
    ["training-room", "rejected", m["reservationRejected.title"]()],
  ] as const)("titles a %s reservation that is %s", (type, status, title) => {
    expect(heading(renderConfirmation({ type, status }))).toBe(title);
  });

  test.each([
    ["table", "submitted", m["reservationSubmitted.message"]()],
    ["table", "confirmed", m["thankYou.confirmation"]()],
    ["table", "rejected", m["reservationRejected.message"]()],
    [
      "training-room",
      "submitted",
      m["trainingReservation.confirmation.message"](),
    ],
    ["training-room", "confirmed", m["thankYou.confirmation"]()],
  ] as const)(
    "explains a %s reservation that is %s",
    (type, status, message) => {
      expect(statusMessage(renderConfirmation({ type, status }))).toBe(message);
    }
  );

  test.each(statuses)(
    "shows a custom message instead of the %s explanation",
    (status) => {
      const html = renderConfirmation({
        status,
        type: "training-room",
        customMessage: <em>custom</em>,
      });

      expect(statusMessage(html)).toBe("<em>custom</em>");
    }
  );

  test("colors a distinct icon for each status", () => {
    const icons = statuses.map((status) =>
      statusIcon(renderConfirmation({ status }))
    );

    expect(icons.map((icon) => icon?.[1])).toEqual([
      "w-8 h-8 text-blue-600",
      "w-8 h-8 text-green-600",
      "w-8 h-8 text-red-600",
    ]);
    expect(new Set(icons.map((icon) => icon?.[2])).size).toBe(3);
  });

  test("shows the booking id only when the reservation has one", () => {
    const bookingId = m["thankYou.bookingId"]({ id: "R-42" });

    expect(renderConfirmation({ details: completeDetails })).toContain(
      `mt-4 px-4 py-2">${bookingId}</div>`
    );
    expect(renderConfirmation({})).not.toContain("mt-4 px-4 py-2");
  });
});

describe("ReservationConfirmation details", () => {
  test.each([
    ["table", m["thankYou.bookingDetails"](), m["descriptions.keepInfo"]()],
    [
      "training-room",
      m["trainingReservation.details.title"](),
      m["trainingReservation.details.description"](),
    ],
  ] as const)("titles the %s details card", (type, title, description) => {
    const html = renderConfirmation({ type });

    expect(html).toContain(title);
    expect(html).toContain(description);
  });

  test("lists every provided detail", () => {
    const html = renderConfirmation({ details: completeDetails });

    expect(html).toContain(formatDurationMinutes(90, routeLocale));
    expect(html).toContain(m.guestCountPlural({ count: 4 }));
    expect(html).toContain(">J</span>");
    expect(html).toContain(">jana@example.test</p>");
    expect(html).toContain(">+420 111 222 333</p>");
    expect(html).toContain(">Near the window</p>");
    expect(html).toContain(
      m["tableReservation.tablePreferences.privateSpace"]()
    );
  });

  test("leaves out the details the reservation lacks", () => {
    const html = renderConfirmation({});

    expect(html).toContain(">Petr</p>");
    for (const label of [
      m["tableReservation.durationLabel"](),
      m["tableReservation.guestCountLabel"](),
      m["tableReservation.emailLabel"](),
      m["tableReservation.phoneLabel"](),
      m["tableReservation.tablePreferenceLabel"](),
      m["tableReservation.specialRequestsLabel"](),
    ]) {
      expect(html).not.toContain(label);
    }
    expect(html).not.toContain(separator);
  });

  test.each([
    ["standard", m["tableReservation.tablePreferences.standard"]()],
    ["large", m["tableReservation.tablePreferences.largerTable"]()],
    ["private", m["tableReservation.tablePreferences.privateSpace"]()],
  ] as const)(
    "names the %s table preference on its own",
    (preference, label) => {
      const html = renderConfirmation({
        details: { ...minimalDetails, tablePreference: preference },
      });

      expect(html).toContain(separator);
      expect(html).toContain(m["tableReservation.tablePreferenceLabel"]());
      expect(html).toContain(`<p class="text-gray-600">${label}</p>`);
      expect(html).not.toContain(m["tableReservation.specialRequestsLabel"]());
    }
  );

  test("shows special requests without a table preference", () => {
    const html = renderConfirmation({
      details: { ...minimalDetails, specialRequests: "Quiet corner" },
    });

    expect(html).toContain(separator);
    expect(html).toContain(">Quiet corner</p>");
    expect(html).not.toContain(m["tableReservation.tablePreferenceLabel"]());
  });
});

describe("ReservationConfirmation next steps", () => {
  test.each([
    ["table", "submitted", m["thankYou.nextStepsPending"]()],
    ["table", "confirmed", m["thankYou.nextStepsConfirmed"]()],
    ["training-room", "submitted", m["trainingReservation.nextSteps"]()],
    ["training-room", "confirmed", m["thankYou.nextStepsConfirmed"]()],
  ] as const)("guides a %s reservation that is %s", (type, status, steps) => {
    const html = renderConfirmation({ type, status });

    expect(html).toContain(m["thankYou.nextSteps"]());
    expect(html).toContain(steps);
  });

  test("leaves next steps out of a rejected reservation", () => {
    const html = renderConfirmation({ status: "rejected" });

    expect(html).not.toContain(m["thankYou.nextSteps"]());
    expect(html).not.toContain(m["thankYou.nextStepsPending"]());
  });
});
