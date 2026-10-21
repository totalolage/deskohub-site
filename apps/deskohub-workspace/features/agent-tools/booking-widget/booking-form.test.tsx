import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { formatCurrencyAmount } from "@deskohub/i18n/currency";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { Cause, Exit } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import type { ComponentProps } from "react";
import { type Locale, m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { BookingMode } from "../show-booking.schema";
import { getInitialDraft } from "./booking-draft";
import { BookingForm } from "./booking-form";
import { BookingRequestFailed, BookingToolFailed } from "./booking-host";
import {
  availabilityResult,
  bookingStart,
  quoteResult,
  reservationResult,
} from "./booking-widget.test-utils";

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
    onCheck: mock(() => undefined),
    onDraftChange: mock((_draft: FormProps["draft"]) => undefined),
    onReserve: mock((_selection: FormProps["selection"]) => undefined),
    onOpenLink: mock((_url: string) => undefined),
  };
  render(
    <BookingForm
      check={AsyncResult.initial()}
      draft={getInitialDraft(start)}
      errors={[]}
      linkFailed={false}
      reservation={AsyncResult.initial()}
      start={start}
      {...handlers}
      {...props}
    />
  );
  return handlers;
};

// Bound per call: the document exists only once the test env is registered.
const screen = {
  get queries() {
    return within(document.body);
  },
};

const status = () => screen.queries.getByRole("status");
const alert = () => screen.queries.getByRole("alert");

describe("BookingForm", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

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

    expect(onReserve).toHaveBeenCalledWith(quotedSelection);
    expect(screen.queries.queryAllByRole("link")).toEqual([]);
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

  test("marks an invalid field and describes it with its message", () => {
    renderForm({ errors: [{ field: "date", reason: "passed" }] });

    const date = screen.queries.getByLabelText(
      m.bookingWidgetDateLabel({}, { locale: "en-US" })
    );
    expect(date.getAttribute("aria-invalid")).toBe("true");
    expect(
      document.getElementById(date.getAttribute("aria-describedby") ?? "")
        ?.textContent
    ).toBe(m.bookingWidgetDatePassed({}, { locale: "en-US" }));
  });

  test("names the office range limits in Czech", () => {
    const start = bookingStart({ mode: "reserve", locale: "cs-CZ" });
    renderForm({
      locale: "cs-CZ",
      draft: { ...getInitialDraft(start), family: "office" },
      errors: [
        { field: "dayCount", max: 28 },
        { field: "seats", max: 4 },
      ],
    });

    expect(
      screen.queries.getByText(
        m.bookingWidgetDayCountRange({ max: 28 }, { locale: "cs-CZ" })
      )
    ).toBeDefined();
    expect(
      screen.queries.getByText(
        m.bookingWidgetSeatCountRange({ max: 4 }, { locale: "cs-CZ" })
      )
    ).toBeDefined();
  });

  test("checks the draft from the button, not a form submission", () => {
    const { onCheck } = renderForm();

    fireEvent.click(
      screen.queries.getByRole("button", {
        name: m.bookingWidgetCheck({}, { locale: "en-US" }),
      })
    );

    expect(onCheck).toHaveBeenCalledTimes(1);
    expect(document.querySelector("form")).toBeNull();
  });
});
