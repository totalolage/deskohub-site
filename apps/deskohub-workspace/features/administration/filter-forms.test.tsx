import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { DotyposCustomerId } from "@deskohub/dotypos/types";
import { m } from "@/features/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { formatNumericPlainDate } from "@/shared/utils/date-time-format";
import type { CustomerListQuery } from "./customer-list-query";
import { operationListQuery } from "./operation-list-query";
import { orderListQuery } from "./order-list-query";
import type { ReservationListQuery } from "./reservation-list-query";

// React DOM detects input events and Radix picks its layout-effect hook when
// they load, so the DOM must exist before either is imported.
registerWorkspaceComponentTestEnv();

const { cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);
const {
  BookingsAdministrationFilterForm,
  CustomersAdministrationFilterForm,
  OperationsAdministrationFilterForm,
  OrdersAdministrationFilterForm,
  ReservationsAdministrationFilterForm,
} = await import("./filter-forms");

async function expectNativeGetSubmission(form: HTMLFormElement) {
  let submitted = false;
  const nativeSubmit = form.submit;
  form.submit = () => {
    submitted = true;
  };
  try {
    fireEvent.submit(form);
    await waitFor(() => expect(submitted).toBe(true));
  } finally {
    form.submit = nativeSubmit;
  }
}

const formEntries = (form: HTMLFormElement) =>
  Array.from(new FormData(form).entries()).map(([name, value]) => [
    name,
    String(value),
  ]);

const getForm = (container: HTMLElement) =>
  container.querySelector("form") as HTMLFormElement;

/** The canonical value a filter submits under `name`. */
const submittedValue = (form: HTMLFormElement, name: string) =>
  new FormData(form).get(name);

const getDateField = (view: ReturnType<typeof render>, name: string) =>
  view.getByRole("combobox", { name }) as HTMLInputElement;

/** The text a date field shows for a canonical date on an en-US route. */
const shownDate = (date: string) =>
  formatNumericPlainDate({
    date: Temporal.PlainDate.from(date),
    locale: "en-US",
  });

// A date field takes typed text when focus leaves it.
const typeDate = (field: HTMLInputElement, text: string) => {
  fireEvent.change(field, { target: { value: text } });
  fireEvent.focusOut(field);
};

const reservationShortcuts = {
  today: { from: "2026-08-12", to: "2026-08-12" },
  upcoming: { from: "2026-08-13" },
  past: { to: "2026-08-11" },
} as const;

// The list's own order and first page, with the filters a test sets.
const reservationFilterForm = ({
  customerId,
  ...query
}: Partial<Omit<ReservationListQuery, "customerId">> & {
  readonly customerId?: string;
}) => (
  <ReservationsAdministrationFilterForm
    defaultFrom="2026-01-01"
    query={{
      direction: "desc",
      page: 1,
      sort: "created",
      ...query,
      ...(customerId && { customerId: customerId as DotyposCustomerId }),
    }}
    shortcuts={reservationShortcuts}
  />
);

// The list's own order and first page, with the filters a test sets.
const customerFilterForm = (query: Partial<CustomerListQuery>) => (
  <CustomersAdministrationFilterForm
    query={{ direction: "desc", page: 1, sort: "activity", ...query }}
    shortcuts={reservationShortcuts}
  />
);

describe("administration filter forms", () => {
  afterEach(() => cleanup());
  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await unregisterWorkspaceComponentTestEnv();
  });

  describe("orders", () => {
    test("replaces dirty dates with the new server range before GET", async () => {
      const view = render(
        <OrdersAdministrationFilterForm
          query={orderListQuery.parse({ from: "2026-08-03", to: "2026-08-10" })}
        />
      );
      const form = getForm(view.container);
      typeDate(getDateField(view, "From"), "2026-08-04");
      typeDate(getDateField(view, "To"), "2026-08-11");
      view.rerender(
        <OrdersAdministrationFilterForm
          query={orderListQuery.parse({ from: "2026-08-03", to: "2026-08-10" })}
        />
      );
      expect(submittedValue(form, "from")).toBe("2026-08-04");
      expect(submittedValue(form, "to")).toBe("2026-08-11");

      view.rerender(
        <OrdersAdministrationFilterForm
          query={orderListQuery.parse({ from: "2026-08-05", to: "2026-08-12" })}
        />
      );

      expect(getDateField(view, "From").value).toBe(shownDate("2026-08-05"));
      expect(getDateField(view, "To").value).toBe(shownDate("2026-08-12"));
      expect(formEntries(form)).toEqual([
        ["from", "2026-08-05"],
        ["to", "2026-08-12"],
      ]);
      await expectNativeGetSubmission(form);
    });

    test("submits a date typed without leaving the field", async () => {
      const view = render(
        <OrdersAdministrationFilterForm
          query={orderListQuery.parse({ from: "2026-08-03", to: "2026-08-10" })}
        />
      );
      const form = getForm(view.container);
      let submittedEntries: string[][] | undefined;
      form.submit = () => {
        submittedEntries = formEntries(form);
      };
      fireEvent.change(getDateField(view, "From"), {
        target: { value: "2026-08-04" },
      });

      fireEvent.submit(form);

      await waitFor(() =>
        expect(submittedEntries).toEqual([
          ["from", "2026-08-04"],
          ["to", "2026-08-10"],
        ])
      );
    });

    test("keeps typed text that is no date from submitting", async () => {
      const view = render(
        <OrdersAdministrationFilterForm
          query={orderListQuery.parse({ from: "2026-08-03", to: "2026-08-10" })}
        />
      );
      const form = getForm(view.container);
      const from = getDateField(view, "From");
      let submitted = false;
      form.submit = () => {
        submitted = true;
      };
      fireEvent.change(from, { target: { value: "2026-13-45" } });

      fireEvent.submit(form);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(submitted).toBe(false);
      expect(document.activeElement).toBe(from);
      expect(from.getAttribute("aria-invalid")).toBe("true");
    });
  });

  describe("bookings", () => {
    test("replaces dirty criteria with the new server selection before GET", async () => {
      const view = render(
        <BookingsAdministrationFilterForm
          query={{
            date: "2026-08-10",
            direction: "desc",
            sort: "status",
            page: 1,
          }}
        />
      );
      const form = getForm(view.container);
      typeDate(getDateField(view, "Booking date"), "2026-08-11");
      view.rerender(
        <BookingsAdministrationFilterForm
          query={{
            date: "2026-08-10",
            direction: "desc",
            sort: "status",
            page: 1,
          }}
        />
      );
      expect(submittedValue(form, "date")).toBe("2026-08-11");

      view.rerender(
        <BookingsAdministrationFilterForm
          query={{
            date: "2026-08-14",
            direction: "asc",
            sort: "booking",
            page: 1,
          }}
        />
      );

      expect(formEntries(form)).toEqual([
        ["date", "2026-08-14"],
        ["sort", "booking"],
        ["direction", "asc"],
      ]);
      await expectNativeGetSubmission(form);
    });

    test("keeps an invalid day from submitting and marks the field", async () => {
      const view = render(
        <BookingsAdministrationFilterForm
          query={{
            date: "2026-02-30",
            direction: "asc",
            page: 1,
            sort: "booking",
          }}
        />
      );
      const form = getForm(view.container);
      const date = getDateField(view, "Booking date");
      let submitted = false;
      form.submit = () => {
        submitted = true;
      };

      fireEvent.submit(form);

      await waitFor(() =>
        expect(date.getAttribute("aria-invalid")).toBe("true")
      );
      expect(submitted).toBe(false);
    });
  });

  describe("operations", () => {
    test("uses changed server dates and provider criteria after navigation", async () => {
      const view = render(
        <OperationsAdministrationFilterForm
          query={operationListQuery.parse({
            channel: "BACKOFFICE",
            operationType: "REFUND",
            from: "2026-07-01",
            to: "2026-08-01",
          })}
        />
      );
      const form = getForm(view.container);
      const channel = view.getByLabelText("Origin") as HTMLSelectElement;
      typeDate(getDateField(view, "From"), "2026-07-02");
      fireEvent.change(channel, { target: { value: "ECOMMERCE" } });
      view.rerender(
        <OperationsAdministrationFilterForm
          query={operationListQuery.parse({
            channel: "BACKOFFICE",
            operationType: "REFUND",
            from: "2026-07-01",
            to: "2026-08-01",
          })}
        />
      );
      expect(submittedValue(form, "from")).toBe("2026-07-02");
      expect(channel.value).toBe("ECOMMERCE");

      view.rerender(
        <OperationsAdministrationFilterForm
          query={operationListQuery.parse({
            channel: "ECOMMERCE",
            operationType: "CAPTURE",
            from: "2026-07-03",
            to: "2026-08-03",
          })}
        />
      );

      expect((view.getByLabelText("Origin") as HTMLSelectElement).value).toBe(
        "ECOMMERCE"
      );
      expect((view.getByLabelText("Type") as HTMLSelectElement).value).toBe(
        "CAPTURE"
      );
      expect(formEntries(form)).toEqual([
        ["from", "2026-07-03"],
        ["to", "2026-08-03"],
        ["channel", "ECOMMERCE"],
        ["operationType", "CAPTURE"],
      ]);
      await expectNativeGetSubmission(form);
    });
  });

  describe("reservations", () => {
    test("submits the exact filter fields as GET and preserves customer and sort values", async () => {
      const view = render(
        reservationFilterForm({
          customerId: "customer-one",
          direction: "asc",
          from: "2026-08-04",
          sort: "status",
          status: "complete",
          to: "2026-08-10",
          type: "office",
        })
      );
      const form = getForm(view.container);
      const type = view.getByLabelText("Reservation type") as HTMLSelectElement;

      expect(form.getAttribute("method")).toBe("get");
      expect(form.getAttribute("action")).toBe("/en-US/admin/reservations");
      expect(type.value).toBe("office");
      expect(type.selectedOptions[0]?.textContent).toBe(
        m.reservationOfficeProductTitle()
      );
      expect(formEntries(form)).toEqual([
        ["status", "complete"],
        ["type", "office"],
        ["from", "2026-08-04"],
        ["to", "2026-08-10"],
        ["customerId", "customer-one"],
        ["sort", "status"],
        ["direction", "asc"],
      ]);
      await expectNativeGetSubmission(form);
    });

    test("replaces dirty values after Clear and date-shortcut navigation", async () => {
      const filteredInput = {
        customerId: "customer-one",
        direction: "asc",
        from: "2026-08-04",
        sort: "status",
        status: "complete",
        to: "2026-08-10",
        type: "office",
      } as const;
      const view = render(reservationFilterForm(filteredInput));
      const form = getForm(view.container);
      fireEvent.change(view.getByLabelText("Deskohub status"), {
        target: { value: "cancelled" },
      });
      typeDate(getDateField(view, "Start date from"), "2026-08-05");
      view.rerender(reservationFilterForm({ ...filteredInput }));
      expect(
        (view.getByLabelText("Deskohub status") as HTMLSelectElement).value
      ).toBe("cancelled");
      expect(submittedValue(form, "from")).toBe("2026-08-05");
      expect(
        view.getByRole("link", { name: "Clear" }).getAttribute("href")
      ).toBe("/en-US/admin/reservations");

      view.rerender(
        reservationFilterForm({ direction: "desc", sort: "created" })
      );

      expect(
        (view.getByLabelText("Deskohub status") as HTMLSelectElement).value
      ).toBe("");
      expect(
        (view.getByLabelText("Reservation type") as HTMLSelectElement).value
      ).toBe("");
      expect(getDateField(view, "Start date from").value).toBe("");
      expect(form.querySelector('input[name="customerId"]')).toBeNull();
      expect(formEntries(form)).toEqual([
        ["status", ""],
        ["type", ""],
        ["from", ""],
        ["to", ""],
        ["sort", "created"],
        ["direction", "desc"],
      ]);
      await expectNativeGetSubmission(form);

      typeDate(getDateField(view, "Start date from"), "2026-08-02");
      fireEvent.change(view.getByLabelText("Deskohub status"), {
        target: { value: "complete" },
      });
      expect(
        view.getByRole("link", { name: "Upcoming" }).getAttribute("href")
      ).toBe(
        "/en-US/admin/reservations?direction=desc&from=2026-08-13&sort=created"
      );

      view.rerender(
        reservationFilterForm({
          direction: "desc",
          from: "2026-08-13",
          sort: "created",
        })
      );

      expect(submittedValue(form, "from")).toBe("2026-08-13");
      expect(
        (view.getByLabelText("Deskohub status") as HTMLSelectElement).value
      ).toBe("");
      expect(form.querySelector('input[name="customerId"]')).toBeNull();
      expect(formEntries(form)).toEqual([
        ["status", ""],
        ["type", ""],
        ["from", "2026-08-13"],
        ["to", ""],
        ["sort", "created"],
        ["direction", "desc"],
      ]);
      await expectNativeGetSubmission(form);
    });
  });
  describe("customers", () => {
    test("submits the date range and consent state as GET and keeps the sort", async () => {
      const view = render(
        customerFilterForm({
          direction: "asc",
          from: "2026-10-01",
          marketingConsent: "active",
          sort: "reservations",
          to: "2026-10-31",
        })
      );
      const form = getForm(view.container);
      const consent = view.getByLabelText(
        "Marketing consent"
      ) as HTMLSelectElement;

      expect(form.getAttribute("method")).toBe("get");
      expect(form.getAttribute("action")).toBe("/en-US/admin/customers");
      expect(getDateField(view, "Reservation start from")).toBeDefined();
      expect(getDateField(view, "Reservation start to")).toBeDefined();
      expect(
        Array.from(consent.options).map(({ textContent, value }) => [
          value,
          textContent,
        ])
      ).toEqual([
        ["", "All consent states"],
        ["active", "Granted"],
        ["withdrawn", "Withdrawn"],
        ["absent", "Never granted"],
      ]);
      expect(formEntries(form)).toEqual([
        ["marketingConsent", "active"],
        ["from", "2026-10-01"],
        ["to", "2026-10-31"],
        ["sort", "reservations"],
        ["direction", "asc"],
      ]);
      await expectNativeGetSubmission(form);
    });

    test("keeps filters and sort in date shortcuts and clears them all", () => {
      const view = render(
        customerFilterForm({
          direction: "asc",
          from: "2026-10-01",
          marketingConsent: "withdrawn",
          sort: "reservations",
        })
      );

      expect(
        view.getByRole("navigation", { name: "Reservation date shortcuts" })
      ).toBeDefined();
      expect(
        ["Today", "Upcoming", "Past"].map((name) =>
          view.getByRole("link", { name }).getAttribute("href")
        )
      ).toEqual([
        "/en-US/admin/customers?direction=asc&from=2026-08-12&marketingConsent=withdrawn&sort=reservations&to=2026-08-12",
        "/en-US/admin/customers?direction=asc&from=2026-08-13&marketingConsent=withdrawn&sort=reservations",
        "/en-US/admin/customers?direction=asc&marketingConsent=withdrawn&sort=reservations&to=2026-08-11",
      ]);
      expect(
        view.getByRole("link", { name: "Clear" }).getAttribute("href")
      ).toBe("/en-US/admin/customers");
    });

    test("offers Clear only when a filter is active", () => {
      const view = render(
        customerFilterForm({ direction: "desc", sort: "activity" })
      );
      expect(view.queryByRole("link", { name: "Clear" })).toBeNull();
      expect(formEntries(getForm(view.container))).toEqual([
        ["marketingConsent", ""],
        ["from", ""],
        ["to", ""],
        ["sort", "activity"],
        ["direction", "desc"],
      ]);
    });

    test("labels the customer filters in Czech", () => {
      const view = render(
        <RouteLocaleProvider locale="cs-CZ">
          {customerFilterForm({ marketingConsent: "absent" })}
        </RouteLocaleProvider>
      );

      expect(view.getByLabelText("Marketingový souhlas")).toBeDefined();
      expect(view.getByLabelText("Začátek rezervace od")).toBeDefined();
      expect(view.getByLabelText("Začátek rezervace do")).toBeDefined();
      expect(
        (view.getByLabelText("Marketingový souhlas") as HTMLSelectElement)
          .selectedOptions[0]?.textContent
      ).toBe("Nikdy neudělen");
    });
  });

  // The server renders without an ambient locale, so a message that falls
  // back to it would differ from the hydrated client on a Czech route.
  test("names reservation types in the route locale", () => {
    const view = render(
      <RouteLocaleProvider locale="cs-CZ">
        {reservationFilterForm({})}
      </RouteLocaleProvider>
    );

    expect(
      view.container.querySelector('#reservation-type option[value="office"]')
        ?.textContent
    ).toBe(m.reservationOfficeProductTitle({}, { locale: "cs-CZ" }));
  });

  test("labels the reservation filters in Czech", () => {
    const view = render(
      <RouteLocaleProvider locale="cs-CZ">
        {reservationFilterForm({ status: "cancelled" })}
      </RouteLocaleProvider>
    );

    const status = view.getByLabelText("Stav v Deskohubu") as HTMLSelectElement;
    expect(status.selectedOptions[0]?.textContent).toBe("Zrušeno");
    expect(view.getByLabelText("Začátek od")).toBeDefined();
    expect(
      view.getByRole("navigation", { name: "Rychlý výběr termínu rezervace" })
    ).toBeDefined();
    expect(
      view.getByRole("link", { name: "Nadcházející" }).getAttribute("href")
    ).toBe(
      "/cs-CZ/admin/reservations?direction=desc&from=2026-08-13&sort=created&status=cancelled"
    );
    expect(view.getByRole("link", { name: "Vymazat" })).toBeDefined();
    expect(view.getByRole("button", { name: "Použít filtry" })).toBeDefined();
  });

  test("labels the payment filters in Czech", () => {
    const view = render(
      <RouteLocaleProvider locale="cs-CZ">
        <BookingsAdministrationFilterForm
          query={{
            date: "2026-08-11",
            direction: "asc",
            sort: "booking",
            page: 1,
          }}
        />
        <OperationsAdministrationFilterForm
          query={operationListQuery.parse({
            from: "2026-07-01",
            to: "2026-07-08",
          })}
        />
      </RouteLocaleProvider>
    );

    expect(view.getByLabelText("Datum rezervace stolu")).toBeDefined();
    expect(
      view.getByRole("button", { name: "Zobrazit rezervace stolů" })
    ).toBeDefined();
    const origin = view.getByLabelText("Původ") as HTMLSelectElement;
    expect(origin.selectedOptions[0]?.textContent).toBe("Vše");
    expect(
      Array.from(origin.options).map(({ textContent }) => textContent)
    ).toContain("Back office Nexi");
    expect(
      view.getByRole("button", { name: "Zobrazit operace" })
    ).toBeDefined();
  });
});
