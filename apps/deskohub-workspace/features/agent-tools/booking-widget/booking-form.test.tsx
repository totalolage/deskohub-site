import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { formatCurrencyAmount } from "@deskohub/i18n/currency";
import { Cause, Exit } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import type { ComponentProps } from "react";
import { type Locale, m } from "@/features/i18n";
import { withMeetingRoomEarlySetup } from "@/features/reservation/meeting-room-early-setup-link";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { BookingMode } from "../show-booking.schema";
import { BookingRequestFailed, BookingToolFailed } from "./booking-host";
import {
  availabilityResult,
  bookingOfferings,
  bookingStart,
  bookingToday,
  meetingRoomAvailabilityResult,
  quoteResult,
  reservationResult,
} from "./booking-widget.test-utils";

registerWorkspaceComponentTestEnv();
// React DOM picks the input events it handles when it loads, so it loads
// after the DOM exists.
const { cleanup, fireEvent, render, waitFor, within } = await import(
  "@testing-library/react"
);
const { BookingForm } = await import("./booking-form");

type FormProps = ComponentProps<typeof BookingForm>;

const czk = (amount: number) =>
  formatCurrencyAmount({ amount, currency: "CZK", locale: "en-US" });

const quotedSelection = {
  family: "cowork",
  date: "2099-07-28",
  tier: "open-space",
} as const;

const quotedCheck = (locale: Locale = "en-US") =>
  AsyncResult.success({
    availability: availabilityResult(true, locale),
    quote: quoteResult(locale),
    selection: quotedSelection,
  });

const renderForm = ({
  mode = "reserve",
  locale = "en-US",
  opensLinks = true,
  ...props
}: Partial<FormProps> & {
  readonly mode?: BookingMode;
  readonly locale?: Locale;
  readonly opensLinks?: boolean;
} = {}) => {
  const start = bookingStart({ mode, locale, opensLinks });
  const handlers = {
    onCheck: mock(
      (_selection: Parameters<FormProps["onCheck"]>[0]) => undefined
    ),
    onSelectionChange: mock(() => undefined),
    onReserve: mock(
      (
        _selection: Parameters<FormProps["onReserve"]>[0],
        _earlySetup: Parameters<FormProps["onReserve"]>[1]
      ) => undefined
    ),
    onOpenLink: mock((_url: string) => undefined),
  };
  const form = (results: Partial<FormProps>) => (
    <BookingForm
      check={AsyncResult.initial()}
      linkFailed={false}
      reservation={AsyncResult.initial()}
      start={start}
      {...handlers}
      {...results}
    />
  );
  const { rerender } = render(form(props));
  return {
    ...handlers,
    /** Renders the same form again with other results. */
    rerender: (results: Partial<FormProps>) => rerender(form(results)),
  };
};

const meetingRoomSelection = {
  family: "meeting-room",
  date: bookingToday,
  start_time: "09:00",
  duration: "hour:1",
} as const;

/** A free meeting-room check and quote, each call a new check. */
const meetingRoomCheck = ({
  earlySetupAvailable,
  startTime = "09:00",
}: {
  readonly earlySetupAvailable: boolean;
  readonly startTime?: string;
}) =>
  AsyncResult.success({
    availability: meetingRoomAvailabilityResult({
      startTime,
      earlySetupAvailable,
    }),
    quote: quoteResult(),
    selection: { ...meetingRoomSelection, start_time: startTime },
  });

// Bound per call: the document exists only once the test env is registered.
const screen = {
  get queries() {
    return within(document.body);
  },
};

const status = () => screen.queries.getByRole("status");
const checkButton = (locale: Locale = "en-US") =>
  screen.queries.getByRole("button", {
    name: m.bookingWidgetCheck({}, { locale }),
  });
/** Picks a radio option, such as a family, by the start of its label. */
const choose = (label: string) =>
  fireEvent.click(
    screen.queries.getByRole("radio", {
      name: (name) => name.startsWith(label),
    })
  );
const alert = () => screen.queries.getByRole("alert");
const earlySetupChoice = () =>
  screen.queries.getByRole<HTMLInputElement>("checkbox", {
    name: m.reservationMeetingRoomEarlySetupLabel({}, { locale: "en-US" }),
  });
const reserve = () =>
  fireEvent.click(
    screen.queries.getByRole("button", {
      name: m.bookingWidgetReserve({}, { locale: "en-US" }),
    })
  );

describe("BookingForm", () => {
  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("keeps both live regions mounted before any result", () => {
    renderForm();

    expect(status().textContent).toBe("");
    expect(alert().textContent).toBe("");
  });

  test("offers the families and the cowork tiers as radio groups", () => {
    renderForm();

    expect(
      screen.queries.getByRole("group", {
        name: m.bookingWidgetFamilyLabel({}, { locale: "en-US" }),
      })
    ).toBeDefined();
    expect(
      screen.queries
        .getAllByRole("radio")
        .map((radio) => radio.getAttribute("value"))
    ).toEqual([
      "cowork",
      "meeting-room",
      "office",
      "open-space",
      "reserved-desk",
    ]);
  });

  test("announces the availability and the quoted total", () => {
    renderForm({ check: quotedCheck() });

    // The tools' notes are written for the agent.
    expect(status().textContent).not.toContain(availabilityResult(true).note);
    expect(status().textContent).not.toContain(quoteResult().note);

    expect(status().textContent).toContain(
      m.bookingWidgetAvailable({}, { locale: "en-US" })
    );
    expect(status().textContent).toContain(
      m.bookingWidgetTotal({ price: czk(250) }, { locale: "en-US" })
    );
    expect(status().textContent).toContain(
      m.bookingWidgetDiscount(
        { discount: czk(40), price: czk(290) },
        { locale: "en-US" }
      )
    );
  });

  test("announces an unavailable selection without an action", () => {
    renderForm({
      check: AsyncResult.success({ availability: availabilityResult(false) }),
    });

    expect(status().textContent).toContain(
      m.bookingWidgetNotAvailable({}, { locale: "en-US" })
    );
    expect(screen.queries.queryAllByRole("link")).toEqual([]);
    expect(
      screen.queries.queryByRole("button", {
        name: m.bookingWidgetReserve({}, { locale: "en-US" }),
      })
    ).toBeNull();
  });

  test("in reserve mode, starts the booking with the quoted selection", () => {
    const { onReserve } = renderForm({ check: quotedCheck() });

    fireEvent.click(
      screen.queries.getByRole("button", {
        name: m.bookingWidgetReserve({}, { locale: "en-US" }),
      })
    );

    expect(onReserve).toHaveBeenCalledWith(quotedSelection, false);
    expect(screen.queries.queryAllByRole("link")).toEqual([]);
    expect(screen.queries.queryAllByRole("checkbox")).toEqual([]);
  });

  test("offers a free meeting-room setup time unchecked and books with the choice", () => {
    const { onReserve } = renderForm({
      check: meetingRoomCheck({ earlySetupAvailable: true }),
    });

    const choice = earlySetupChoice();
    expect(choice.checked).toBe(false);
    expect(choice.disabled).toBe(false);
    expect(choice.hasAttribute("aria-describedby")).toBe(false);

    fireEvent.click(choice);
    expect(earlySetupChoice().checked).toBe(true);
    reserve();

    expect(onReserve).toHaveBeenCalledWith(meetingRoomSelection, true);
  });

  test("books a meeting room without early setup unless the customer chooses it", () => {
    const { onReserve } = renderForm({
      check: meetingRoomCheck({ earlySetupAvailable: true }),
    });

    reserve();

    expect(onReserve).toHaveBeenCalledWith(meetingRoomSelection, false);
  });

  test("disables early setup with a reason when the room is booked just before the start", () => {
    const { onReserve } = renderForm({
      check: meetingRoomCheck({ earlySetupAvailable: false }),
    });

    const choice = earlySetupChoice();
    expect(choice.checked).toBe(false);
    expect(choice.disabled).toBe(true);
    const reasonId = choice.getAttribute("aria-describedby");
    expect(
      reasonId && document.getElementById(reasonId)?.textContent
    ).toBeTruthy();
    reserve();

    expect(onReserve).toHaveBeenCalledWith(meetingRoomSelection, false);
  });

  test("drops the setup choice when a new start's setup time is taken", () => {
    const { onReserve, rerender } = renderForm({
      check: meetingRoomCheck({ earlySetupAvailable: true }),
    });
    fireEvent.click(earlySetupChoice());

    rerender({
      check: meetingRoomCheck({
        earlySetupAvailable: false,
        startTime: "11:00",
      }),
    });
    expect(earlySetupChoice().checked).toBe(false);
    expect(earlySetupChoice().disabled).toBe(true);
    reserve();
    expect(onReserve).toHaveBeenLastCalledWith(
      { ...meetingRoomSelection, start_time: "11:00" },
      false
    );

    // A later free start asks again rather than restoring the choice.
    rerender({ check: meetingRoomCheck({ earlySetupAvailable: true }) });
    expect(earlySetupChoice().checked).toBe(false);
    expect(earlySetupChoice().disabled).toBe(false);
  });

  test("keeps the setup choice for another start whose setup time is free", () => {
    const { onReserve, rerender } = renderForm({
      check: meetingRoomCheck({ earlySetupAvailable: true }),
    });
    fireEvent.click(earlySetupChoice());

    // The changed selection clears the results, and the check can fail.
    rerender({ check: AsyncResult.initial() });
    rerender({
      check: AsyncResult.failure(Cause.fail(new BookingRequestFailed({}))),
    });
    rerender({
      check: meetingRoomCheck({
        earlySetupAvailable: true,
        startTime: "11:00",
      }),
    });

    expect(earlySetupChoice().checked).toBe(true);
    reserve();
    expect(onReserve).toHaveBeenCalledWith(
      { ...meetingRoomSelection, start_time: "11:00" },
      true
    );
  });

  test("holds Reserve and the setup choice while a new check runs", () => {
    const check = meetingRoomCheck({ earlySetupAvailable: true });
    const { onReserve, rerender } = renderForm({ check });
    fireEvent.click(earlySetupChoice());

    rerender({ check: AsyncResult.waiting(check) });
    expect(earlySetupChoice().checked).toBe(true);
    expect(earlySetupChoice().disabled).toBe(true);
    reserve();
    expect(onReserve).not.toHaveBeenCalled();

    rerender({ check: meetingRoomCheck({ earlySetupAvailable: true }) });
    expect(earlySetupChoice().checked).toBe(true);
    reserve();
    expect(onReserve).toHaveBeenCalledWith(meetingRoomSelection, true);
  });

  test("keeps the setup choice of a held booking and stops changes to it", () => {
    const check = meetingRoomCheck({ earlySetupAvailable: true });
    const { rerender } = renderForm({ check });
    fireEvent.click(earlySetupChoice());

    rerender({
      check,
      reservation: AsyncResult.waiting(AsyncResult.initial()),
    });
    expect(earlySetupChoice().checked).toBe(true);
    expect(earlySetupChoice().disabled).toBe(true);

    rerender({ check, reservation: AsyncResult.success(reservationResult()) });

    expect(earlySetupChoice().checked).toBe(true);
    expect(earlySetupChoice().disabled).toBe(true);
  });

  test("carries the setup choice to the reservation page after a failed booking", () => {
    const check = meetingRoomCheck({ earlySetupAvailable: true });
    const { rerender } = renderForm({ check });
    fireEvent.click(earlySetupChoice());

    rerender({
      check,
      reservation: AsyncResult.fromExit(
        Exit.fail(
          new BookingToolFailed({
            error: { code: "profile_incomplete", message: "" },
          })
        )
      ),
    });

    expect(
      screen.queries
        .getByRole("link", {
          name: m.bookingWidgetOpenReservationPage({}, { locale: "en-US" }),
        })
        .getAttribute("href")
    ).toBe(withMeetingRoomEarlySetup(quoteResult().reservation_url));
  });

  test("leaves early setup to the reservation page in reservation page mode", () => {
    renderForm({
      mode: "reservation_page",
      check: meetingRoomCheck({ earlySetupAvailable: true }),
    });

    expect(screen.queries.queryAllByRole("checkbox")).toEqual([]);
  });

  test("disables Reserve while the booking starts", () => {
    renderForm({
      check: quotedCheck(),
      reservation: AsyncResult.waiting(AsyncResult.initial()),
    });

    expect(
      screen.queries
        .getByRole("button", {
          name: m.bookingWidgetReserve({}, { locale: "en-US" }),
        })
        .hasAttribute("disabled")
    ).toBe(true);
    expect(status().textContent).toContain(
      m.bookingWidgetReserving({}, { locale: "en-US" })
    );
  });

  test("after the booking starts, links the Pay page with its expiry", () => {
    const reservation = reservationResult();
    const { onOpenLink } = renderForm({
      check: quotedCheck(),
      reservation: AsyncResult.success(reservation),
    });

    const expiresAt = new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(Date.parse(reservation.pay_url_expires_at));
    expect(status().textContent).toContain(
      m.bookingWidgetHeld({ expiresAt }, { locale: "en-US" })
    );
    const payLink = screen.queries.getByRole("link", {
      name: m.bookingWidgetOpenPaymentPage({}, { locale: "en-US" }),
    });
    expect(payLink.getAttribute("href")).toBe(reservation.pay_url);
    expect(screen.queries.getByText(reservation.pay_url)).toBeDefined();
    expect(
      screen.queries.queryByRole("button", {
        name: m.bookingWidgetReserve({}, { locale: "en-US" }),
      })
    ).toBeNull();

    fireEvent.click(payLink);
    expect(onOpenLink).toHaveBeenCalledWith(reservation.pay_url);
    expect(status().textContent).not.toContain(reservation.note);
    expect(status().textContent).not.toContain(
      m.bookingWidgetPriceChanged(
        { price: czk(reservation.total.amount) },
        { locale: "en-US" }
      )
    );
  });

  test("announces a total that changed since the quote", () => {
    const reservation = {
      ...reservationResult(),
      total: { amount: 270, currency: "CZK" },
      price_changed: true,
    };
    renderForm({
      check: quotedCheck(),
      reservation: AsyncResult.success(reservation),
    });

    expect(status().textContent).toContain(
      m.bookingWidgetPriceChanged({ price: czk(270) }, { locale: "en-US" })
    );
  });

  test("words a failed booking from its code and falls back to the reservation page", () => {
    const message = m.agentToolErrorProfileIncomplete({}, { locale: "en-US" });
    renderForm({
      check: quotedCheck(),
      reservation: AsyncResult.fromExit(
        Exit.fail(
          new BookingToolFailed({
            error: { code: "profile_incomplete", message },
          })
        )
      ),
    });

    expect(alert().textContent).not.toContain(message);
    expect(alert().textContent).toContain(
      m.bookingWidgetErrorProfileIncomplete({}, { locale: "en-US" })
    );
    expect(alert().textContent).toContain(
      m.bookingWidgetReserveFallback({}, { locale: "en-US" })
    );
    expect(
      screen.queries
        .getByRole("link", {
          name: m.bookingWidgetOpenReservationPage({}, { locale: "en-US" }),
        })
        .getAttribute("href")
    ).toBe(quoteResult().reservation_url);
    expect(
      screen.queries.queryByText(
        m.bookingWidgetReservationPageHint({}, { locale: "en-US" })
      )
    ).toBeNull();
  });

  test("in reservation page mode, links the prefilled reservation page instead of Reserve", () => {
    renderForm({
      mode: "reservation_page",
      locale: "cs-CZ",
      check: quotedCheck("cs-CZ"),
    });

    expect(
      screen.queries.queryByRole("button", {
        name: m.bookingWidgetReserve({}, { locale: "cs-CZ" }),
      })
    ).toBeNull();
    expect(
      screen.queries
        .getByRole("link", {
          name: m.bookingWidgetOpenReservationPage({}, { locale: "cs-CZ" }),
        })
        .getAttribute("href")
    ).toBe(quoteResult().reservation_url);
    expect(
      screen.queries.getByText(quoteResult().reservation_url)
    ).toBeDefined();
    expect(
      screen.queries.getByText(
        m.bookingWidgetReservationPageHint({}, { locale: "cs-CZ" })
      )
    ).toBeDefined();
  });

  test("leaves the link to the browser when the host can't open links", () => {
    const { onOpenLink } = renderForm({
      mode: "reservation_page",
      opensLinks: false,
      check: quotedCheck(),
    });

    const link = screen.queries.getByRole("link", {
      name: m.bookingWidgetOpenReservationPage({}, { locale: "en-US" }),
    });
    expect(fireEvent.click(link)).toBe(true);
    expect(onOpenLink).not.toHaveBeenCalled();
  });

  test("names the bookable dates of an out-of-range check", () => {
    renderForm({
      locale: "cs-CZ",
      check: AsyncResult.failure(
        Cause.fail(
          new BookingToolFailed({
            error: {
              code: "date_out_of_range",
              earliest: "2099-07-28",
              latest: "2099-10-26",
              message: "",
            },
          })
        )
      ),
    });

    const format = (date: string) =>
      new Intl.DateTimeFormat("cs-CZ", {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(Date.parse(date));
    expect(alert().textContent).toBe(
      m.bookingWidgetErrorDateOutOfRange(
        { earliest: format("2099-07-28"), latest: format("2099-10-26") },
        { locale: "cs-CZ" }
      )
    );
  });

  test("reports a tool error the customer can't act on as unavailable", () => {
    renderForm({
      check: AsyncResult.failure(
        Cause.fail(
          new BookingToolFailed({
            error: { code: "quote_unavailable", message: "" },
          })
        )
      ),
    });

    expect(alert().textContent).toBe(
      m.bookingWidgetErrorUnavailable({}, { locale: "en-US" })
    );
  });

  test("reports a request the host couldn't carry", () => {
    renderForm({
      check: AsyncResult.failure(Cause.fail(new BookingRequestFailed({}))),
    });

    expect(alert().textContent).toBe(
      m.bookingWidgetRequestFailed({}, { locale: "en-US" })
    );
  });

  test("marks an invalid field and describes it with its message", async () => {
    const { onCheck, onSelectionChange } = renderForm();
    const date = screen.queries.getByLabelText(
      m.bookingWidgetDateLabel({}, { locale: "en-US" })
    );

    fireEvent.input(date, { target: { value: "2099-07-27" } });
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    fireEvent.click(checkButton());

    await waitFor(() => expect(date.getAttribute("aria-invalid")).toBe("true"));
    expect(
      date
        .getAttribute("aria-describedby")
        ?.split(" ")
        .map((id) => document.getElementById(id)?.textContent)
    ).toContain(m.bookingWidgetDatePassed({}, { locale: "en-US" }));
    expect(onCheck).not.toHaveBeenCalled();
    // An invalid selection clears earlier results too.
    expect(onSelectionChange).toHaveBeenCalledTimes(2);
  });

  test("names the office range limits in Czech", async () => {
    renderForm({ locale: "cs-CZ" });

    choose(m.bookingWidgetFamilyOffice({}, { locale: "cs-CZ" }));
    fireEvent.input(
      screen.queries.getByLabelText(
        m.reservationOfficeDayCountLabel({}, { locale: "cs-CZ" })
      ),
      { target: { value: "29" } }
    );
    fireEvent.input(
      screen.queries.getByLabelText(
        m.reservationOfficeSeatCountLabel({}, { locale: "cs-CZ" })
      ),
      { target: { value: "7" } }
    );
    fireEvent.click(checkButton("cs-CZ"));

    await waitFor(() =>
      expect(
        screen.queries.getByText(
          m.bookingWidgetDayCountRange({ max: 28 }, { locale: "cs-CZ" })
        )
      ).toBeDefined()
    );
    expect(
      screen.queries.getByText(
        m.bookingWidgetSeatCountRange({ max: 6 }, { locale: "cs-CZ" })
      )
    ).toBeDefined();
  });

  test("drops a start time error once the meeting room takes the whole day", async () => {
    const { onCheck } = renderForm();

    choose(m.bookingWidgetFamilyMeetingRoom({}, { locale: "en-US" }));
    fireEvent.click(checkButton());
    const required = m.bookingWidgetStartTimeRequired({}, { locale: "en-US" });
    await waitFor(() =>
      expect(screen.queries.getByText(required)).toBeDefined()
    );

    const wholeDay = bookingOfferings().find(
      ({ duration }) => duration === "day:1"
    );
    choose(wholeDay?.duration_label ?? "");
    expect(screen.queries.queryByText(required)).toBeNull();
    fireEvent.click(checkButton());

    await waitFor(() =>
      expect(onCheck).toHaveBeenCalledWith({
        family: "meeting-room",
        date: bookingToday,
        duration: "day:1",
      })
    );
  });

  test("names the monitor setup the view picked when only workstation desks are left", () => {
    const monitors = bookingOfferings()
      .find(({ tier }) => tier === "reserved-desk")
      ?.add_ons.find(({ id }) => id === "workstation")?.options?.[0];
    renderForm({
      check: AsyncResult.success({
        availability: availabilityResult(true),
        quote: quoteResult(),
        selection: {
          family: "cowork",
          date: bookingToday,
          tier: "reserved-desk",
          monitor_option: "2x27-qhd",
        },
      }),
    });

    expect(monitors?.id).toBe("2x27-qhd");
    expect(status().textContent).toContain(
      m.bookingWidgetWorkstationIncluded(
        { monitors: monitors?.name ?? "" },
        { locale: "en-US" }
      )
    );
  });

  test("checks the draft from the button, not a form submission", async () => {
    const { onCheck } = renderForm();

    fireEvent.click(checkButton());

    await waitFor(() => expect(onCheck).toHaveBeenCalledTimes(1));
    expect(onCheck).toHaveBeenCalledWith({
      family: "cowork",
      date: bookingToday,
      tier: "open-space",
    });
    expect(document.querySelector("form")).toBeNull();
  });
});
