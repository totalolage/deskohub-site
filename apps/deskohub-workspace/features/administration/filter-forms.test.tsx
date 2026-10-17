import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { m } from "@/features/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  BookingsAdministrationFilterForm,
  OperationsAdministrationFilterForm,
  OrdersAdministrationFilterForm,
  ReservationsAdministrationFilterForm,
} from "./filter-forms";

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

const reservationShortcuts = {
  today: { from: "2026-08-12", to: "2026-08-12" },
  upcoming: { from: "2026-08-13" },
  past: { to: "2026-08-11" },
} as const;

type ReservationFilterInput = Parameters<
  typeof ReservationsAdministrationFilterForm
>[0]["input"];

const reservationFilterForm = (input: ReservationFilterInput) => (
  <ReservationsAdministrationFilterForm
    defaultFrom="2026-01-01"
    input={input}
    shortcuts={reservationShortcuts}
  />
);

describe("administration filter forms", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => cleanup());
  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await unregisterWorkspaceComponentTestEnv();
  });

  describe("orders", () => {
    test("replaces dirty dates with the new server range before GET", async () => {
      const view = render(
        <OrdersAdministrationFilterForm
          range={{ from: "2026-08-03", to: "2026-08-10" }}
        />
      );
      const from = view.getByLabelText("From") as HTMLInputElement;
      const to = view.getByLabelText("To") as HTMLInputElement;
      fireEvent.change(from, { target: { value: "2026-08-04" } });
      fireEvent.change(to, { target: { value: "2026-08-11" } });
      view.rerender(
        <OrdersAdministrationFilterForm
          range={{ from: "2026-08-03", to: "2026-08-10" }}
        />
      );
      expect(from.value).toBe("2026-08-04");
      expect(to.value).toBe("2026-08-11");

      view.rerender(
        <OrdersAdministrationFilterForm
          range={{ from: "2026-08-05", to: "2026-08-12" }}
        />
      );

      expect(from.value).toBe("2026-08-05");
      expect(to.value).toBe("2026-08-12");
      const form = getForm(view.container);
      expect(formEntries(form)).toEqual([
        ["from", "2026-08-05"],
        ["to", "2026-08-12"],
      ]);
      await expectNativeGetSubmission(form);
    });
  });

  describe("bookings", () => {
    test("replaces dirty criteria with the new server selection before GET", async () => {
      const view = render(
        <BookingsAdministrationFilterForm
          input={{ date: "2026-08-10", direction: "desc", sort: "status" }}
        />
      );
      const date = view.getByLabelText("Booking date") as HTMLInputElement;
      fireEvent.change(date, { target: { value: "2026-08-11" } });
      view.rerender(
        <BookingsAdministrationFilterForm
          input={{ date: "2026-08-10", direction: "desc", sort: "status" }}
        />
      );
      expect(date.value).toBe("2026-08-11");

      view.rerender(
        <BookingsAdministrationFilterForm
          input={{ date: "2026-08-14", direction: "asc", sort: "booking" }}
        />
      );

      expect(date.value).toBe("2026-08-14");
      const form = getForm(view.container);
      expect(formEntries(form)).toEqual([
        ["date", "2026-08-14"],
        ["sort", "booking"],
        ["direction", "asc"],
      ]);
      await expectNativeGetSubmission(form);
    });
  });

  describe("operations", () => {
    test("uses changed server dates and provider criteria after navigation", async () => {
      const view = render(
        <OperationsAdministrationFilterForm
          input={{ channel: "BACKOFFICE", operationType: "REFUND" }}
          range={{ from: "2026-07-01", to: "2026-08-01" }}
        />
      );
      const from = view.getByLabelText("From") as HTMLInputElement;
      const channel = view.getByLabelText("Origin") as HTMLSelectElement;
      fireEvent.change(from, { target: { value: "2026-07-02" } });
      fireEvent.change(channel, { target: { value: "ECOMMERCE" } });
      view.rerender(
        <OperationsAdministrationFilterForm
          input={{ channel: "BACKOFFICE", operationType: "REFUND" }}
          range={{ from: "2026-07-01", to: "2026-08-01" }}
        />
      );
      expect(from.value).toBe("2026-07-02");
      expect(channel.value).toBe("ECOMMERCE");

      view.rerender(
        <OperationsAdministrationFilterForm
          input={{ channel: "ECOMMERCE", operationType: "CAPTURE" }}
          range={{ from: "2026-07-03", to: "2026-08-03" }}
        />
      );

      expect(from.value).toBe("2026-07-03");
      expect((view.getByLabelText("To") as HTMLInputElement).value).toBe(
        "2026-08-03"
      );
      expect((view.getByLabelText("Origin") as HTMLSelectElement).value).toBe(
        "ECOMMERCE"
      );
      expect((view.getByLabelText("Type") as HTMLSelectElement).value).toBe(
        "CAPTURE"
      );
      const form = getForm(view.container);
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
      fireEvent.change(view.getByLabelText("Start date from"), {
        target: { value: "2026-08-05" },
      });
      view.rerender(reservationFilterForm({ ...filteredInput }));
      expect(
        (view.getByLabelText("Deskohub status") as HTMLSelectElement).value
      ).toBe("cancelled");
      expect(
        (view.getByLabelText("Start date from") as HTMLInputElement).value
      ).toBe("2026-08-05");
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
      expect(
        (view.getByLabelText("Start date from") as HTMLInputElement).value
      ).toBe("");
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

      fireEvent.change(view.getByLabelText("Start date from"), {
        target: { value: "2026-08-02" },
      });
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

      expect(
        (view.getByLabelText("Start date from") as HTMLInputElement).value
      ).toBe("2026-08-13");
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
    ).toBe("/cs-CZ/admin/reservations?from=2026-08-13&status=cancelled");
    expect(view.getByRole("link", { name: "Vymazat" })).toBeDefined();
    expect(view.getByRole("button", { name: "Použít filtry" })).toBeDefined();
  });

  test("labels the payment filters in Czech", () => {
    const view = render(
      <RouteLocaleProvider locale="cs-CZ">
        <BookingsAdministrationFilterForm
          input={{ date: "2026-08-11", direction: "asc", sort: "booking" }}
        />
        <OperationsAdministrationFilterForm
          input={{}}
          range={{ from: "2026-07-01", to: "2026-07-08" }}
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
