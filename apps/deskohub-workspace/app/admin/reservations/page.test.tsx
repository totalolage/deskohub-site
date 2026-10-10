import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import type {
  AdministrationReservationListInput,
  AdministrationReservationPage,
} from "@/features/administration/administration.service";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("server-only", () => ({}));
mock.module("next/server", () => ({ connection: () => Promise.resolve() }));

type LoadedReservationPage = {
  readonly input: AdministrationReservationListInput;
  readonly result: AdministrationReservationPage & {
    readonly dateFilterUnavailable: boolean;
    readonly dateSortUnavailable: boolean;
  };
};

type SearchParams = Promise<
  Record<string, string | readonly string[] | undefined>
>;

const defaultReservationPage: LoadedReservationPage = {
  input: {},
  result: {
    items: [],
    page: 1,
    pageCount: 1,
    total: 115,
    dateFilterUnavailable: false,
    dateSortUnavailable: false,
  },
};

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

let reservationPage: LoadedReservationPage = defaultReservationPage;
let receivedReservationSearchParams: SearchParams | undefined;
let reservationPageInput:
  | Promise<AdministrationReservationListInput>
  | undefined;

mock.module("@/features/administration/page-data.server", () => ({
  loadAdministrationRefundAttention: () => Promise.resolve(3),
  loadAdministrationReservations: (searchParams: SearchParams) => {
    receivedReservationSearchParams = searchParams;
    return Promise.resolve(reservationPage);
  },
  loadAdministrationReservationsPage: (searchParams: SearchParams) => {
    receivedReservationSearchParams = searchParams;
    return {
      input: reservationPageInput ?? Promise.resolve(reservationPage.input),
      result: Promise.resolve(reservationPage.result),
    };
  },
}));

mock.module("@/features/administration/reservation-lookup", () => ({
  ReservationLookup: () => null,
}));

describe("ReservationsAdministrationPage", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => {
    cleanup();
    reservationPage = defaultReservationPage;
    receivedReservationSearchParams = undefined;
    reservationPageInput = undefined;
  });
  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await unregisterWorkspaceComponentTestEnv();
  });

  test("shows the reservation count as a compact accessible badge", async () => {
    const { ReservationsAdministrationContent } = await import("./page");
    const view = render(
      await ReservationsAdministrationContent({
        searchParams: Promise.resolve({}),
      })
    );

    expect(view.getByLabelText("115 reservations").textContent).toBe("115");
    expect(
      view.getByRole("combobox", { name: "Deskohub status" })
    ).toBeDefined();
    expect(view.queryByText("115 reservations")).toBeNull();
  });

  test("waits for request input before reading the default date", async () => {
    const originalNow = Temporal.Now.instant;
    let nowReadCount = 0;
    Temporal.Now.instant = () => {
      nowReadCount += 1;
      return Temporal.Instant.from("2026-08-12T10:00:00Z");
    };

    let resolveInput!: (input: AdministrationReservationListInput) => void;
    reservationPageInput = new Promise((resolve) => {
      resolveInput = resolve;
    });
    let filterContent: Promise<ReactNode> | undefined;

    try {
      const { default: ReservationsAdministrationPage } = await import(
        "./page"
      );
      const page = ReservationsAdministrationPage({
        searchParams: Promise.resolve({}),
      }) as ReactElement<{ readonly children: ReactNode }>;
      const pageChildren = page.props.children as readonly ReactNode[];
      const toolbar = pageChildren[2] as ReactElement<{
        readonly filters: ReactElement<{ readonly children: ReactElement }>;
      }>;
      const filterLeaf = toolbar.props.filters.props.children;
      const renderFilterLeaf = filterLeaf.type as (
        props: typeof filterLeaf.props
      ) => Promise<ReactNode>;

      filterContent = renderFilterLeaf(filterLeaf.props);
      expect(nowReadCount).toBe(0);
    } finally {
      try {
        resolveInput({});
        if (filterContent) await filterContent;
      } finally {
        Temporal.Now.instant = originalNow;
      }
    }

    expect(nowReadCount).toBeGreaterThan(0);
  });

  test("offers the refund work queue as a status filter", async () => {
    reservationPage = {
      ...defaultReservationPage,
      input: { status: "needs_refund" },
    };
    const { ReservationsAdministrationContent } = await import("./page");
    const view = render(
      await ReservationsAdministrationContent({
        searchParams: Promise.resolve({ status: "needs_refund" }),
      })
    );

    const status = view.getByRole("combobox", { name: "Deskohub status" });
    expect(
      within(status).getByRole("option", { name: "Needs refund" })
    ).toBeDefined();
    expect((status as HTMLSelectElement).value).toBe("needs_refund");
  });

  test("preserves server sorting while moving across reservation pages", async () => {
    reservationPage = {
      input: { direction: "asc", sort: "reservation" },
      result: {
        items: [
          {
            id: "reservation-on-page-two",
            customerId: "customer-one",
            customer: null,
            liveDetailsAvailable: false,
            startsAt: null,
            endsAt: null,
            date: null,
            type: "cowork",
            typeLabel: "Cowork Basic",
            purpose: null,
            status: { group: "in_progress", label: "Awaiting payment" },
            statusNote: null,
            createdAt: "2026-08-10T08:00:00Z",
            latestPayment: null,
            updatedAt: "2026-08-10T08:00:00Z",
          },
        ],
        page: 2,
        pageCount: 3,
        total: 49,
        dateFilterUnavailable: false,
        dateSortUnavailable: false,
      },
    };
    const { ReservationsAdministrationContent } = await import("./page");
    const view = render(
      await ReservationsAdministrationContent({
        searchParams: Promise.resolve({
          direction: "asc",
          page: "2",
          sort: "reservation",
        }),
      })
    );

    const table = view.getByRole("table", { name: "Reservations" });
    expect(
      within(table)
        .getByRole("link", { name: "Reservation" })
        .closest("th")
        ?.getAttribute("aria-sort")
    ).toBe("ascending");
    expect(
      view.getByRole("link", { name: "Previous" }).getAttribute("href")
    ).toBe("/admin/reservations?direction=asc&sort=reservation");
    expect(view.getByRole("link", { name: "Next" }).getAttribute("href")).toBe(
      "/admin/reservations?direction=asc&sort=reservation&page=3"
    );
  });

  test("preserves other filters when clearing the customer", async () => {
    reservationPage = {
      input: {
        customerId: "customer-one",
        direction: "asc",
        from: "2026-08-04",
        sort: "status",
        status: "complete",
        to: "2026-08-10",
        type: "cowork",
      },
      result: defaultReservationPage.result,
    };
    const { ReservationsAdministrationContent } = await import("./page");
    const view = render(
      await ReservationsAdministrationContent({
        searchParams: Promise.resolve({
          customerId: "customer-one",
          direction: "asc",
          from: "2026-08-04",
          sort: "status",
          status: "complete",
          to: "2026-08-10",
          type: "cowork",
        }),
      })
    );

    expect(
      view.getByRole("link", { name: "Clear customer" }).getAttribute("href")
    ).toBe(
      "/admin/reservations?direction=asc&from=2026-08-04&sort=status&status=complete&to=2026-08-10&type=cowork"
    );
  });

  test("shows the selected inclusive start-date range", async () => {
    reservationPage = {
      input: {
        direction: "asc",
        from: "2026-08-04",
        sort: "date",
        to: "2026-08-10",
      },
      result: {
        ...defaultReservationPage.result,
        page: 2,
        pageCount: 3,
      },
    };
    const { ReservationsAdministrationContent } = await import("./page");
    const view = render(
      await ReservationsAdministrationContent({
        searchParams: Promise.resolve({
          direction: "asc",
          from: "2026-08-04",
          sort: "date",
          to: "2026-08-10",
        }),
      })
    );

    expect(view.getByLabelText("Start date from").getAttribute("value")).toBe(
      "2026-08-04"
    );
    expect(view.getByLabelText("Start date to").getAttribute("value")).toBe(
      "2026-08-10"
    );
    expect(view.getByRole("link", { name: "Next" }).getAttribute("href")).toBe(
      "/admin/reservations?direction=asc&from=2026-08-04&sort=date&to=2026-08-10&page=3"
    );
  });

  test("submits the exact filter fields as GET and preserves customer and sort values", async () => {
    reservationPage = {
      input: {
        customerId: "customer-one",
        direction: "asc",
        from: "2026-08-04",
        sort: "status",
        status: "complete",
        to: "2026-08-10",
        type: "office",
      },
      result: defaultReservationPage.result,
    };
    const reservationQuery = {
      customerId: "customer-one",
      direction: "asc",
      from: "2026-08-04",
      sort: "status",
      status: "complete",
      to: "2026-08-10",
      type: "office",
    };
    const { ReservationsAdministrationContent } = await import("./page");
    const view = render(
      await ReservationsAdministrationContent({
        searchParams: Promise.resolve(reservationQuery),
      })
    );
    const form = view.container.querySelector("form");

    expect(form?.getAttribute("method")).toBe("get");
    expect(form?.getAttribute("action")).toBe("/admin/reservations");
    expect(await receivedReservationSearchParams).toEqual(reservationQuery);
    expect(
      (view.getByLabelText("Reservation type") as HTMLSelectElement).value
    ).toBe("office");
    expect(
      (view.getByLabelText("Reservation type") as HTMLSelectElement)
        .selectedOptions[0]?.textContent
    ).toBe(m.reservationOfficeProductTitle());
    const encodedQuery = new URLSearchParams();
    for (const [name, value] of new FormData(
      form as HTMLFormElement
    ).entries()) {
      encodedQuery.append(name, String(value));
    }
    expect(encodedQuery.toString()).toBe(
      "status=complete&type=office&from=2026-08-04&to=2026-08-10&customerId=customer-one&sort=status&direction=asc"
    );
    await expectNativeGetSubmission(form as HTMLFormElement);
  });

  test("submits customer-less reservation criteria through native GET", async () => {
    const query = { direction: "desc", sort: "created" };
    reservationPage = {
      input: { direction: "desc", sort: "created" },
      result: defaultReservationPage.result,
    };
    const { ReservationsAdministrationContent } = await import("./page");
    const view = render(
      await ReservationsAdministrationContent({
        searchParams: Promise.resolve(query),
      })
    );
    const form = view.container.querySelector("form") as HTMLFormElement;

    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("action")).toBe("/admin/reservations");
    expect(form.querySelector('input[name="customerId"]')).toBeNull();
    expect(
      Array.from(new FormData(form).entries()).map(([name, value]) => [
        name,
        String(value),
      ])
    ).toEqual([
      ["status", ""],
      ["type", ""],
      ["from", ""],
      ["to", ""],
      ["sort", "created"],
      ["direction", "desc"],
    ]);
    await expectNativeGetSubmission(form);
  });

  test("replaces dirty values after Clear and date-shortcut navigation", async () => {
    const originalNow = Temporal.Now.instant;
    Temporal.Now.instant = () => Temporal.Instant.from("2026-08-12T10:00:00Z");
    const firstQuery = {
      customerId: "customer-one",
      direction: "asc",
      from: "2026-08-04",
      sort: "status",
      status: "complete",
      to: "2026-08-10",
      type: "office",
    };
    reservationPage = {
      input: firstQuery,
      result: defaultReservationPage.result,
    };

    try {
      const { ReservationsAdministrationContent } = await import("./page");
      const view = render(
        await ReservationsAdministrationContent({
          searchParams: Promise.resolve(firstQuery),
        })
      );
      const form = view.container.querySelector("form") as HTMLFormElement;
      fireEvent.change(view.getByLabelText("Deskohub status"), {
        target: { value: "cancelled" },
      });
      fireEvent.change(view.getByLabelText("Start date from"), {
        target: { value: "2026-08-05" },
      });
      view.rerender(
        await ReservationsAdministrationContent({
          searchParams: Promise.resolve(firstQuery),
        })
      );
      expect(
        (view.getByLabelText("Deskohub status") as HTMLSelectElement).value
      ).toBe("cancelled");
      expect(
        (view.getByLabelText("Start date from") as HTMLInputElement).value
      ).toBe("2026-08-05");
      expect(
        view.getByRole("link", { name: "Clear" }).getAttribute("href")
      ).toBe("/admin/reservations");

      reservationPage = {
        input: { direction: "desc", sort: "created" },
        result: defaultReservationPage.result,
      };
      view.rerender(
        await ReservationsAdministrationContent({
          searchParams: Promise.resolve({}),
        })
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
      let entries = Array.from(new FormData(form).entries()).map(
        ([name, value]) => [name, String(value)]
      );
      expect(entries).toEqual([
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
      const upcomingHref = view
        .getByRole("link", { name: "Upcoming" })
        .getAttribute("href");
      expect(upcomingHref).toBe(
        "/admin/reservations?direction=desc&from=2026-08-13&sort=created"
      );
      const upcomingQuery = Object.fromEntries(
        new URL(upcomingHref as string, "http://workspace.test").searchParams
      );
      reservationPage = {
        input: {
          direction: "desc",
          from: "2026-08-13",
          sort: "created",
        },
        result: defaultReservationPage.result,
      };
      view.rerender(
        await ReservationsAdministrationContent({
          searchParams: Promise.resolve(upcomingQuery),
        })
      );

      expect(
        (view.getByLabelText("Start date from") as HTMLInputElement).value
      ).toBe("2026-08-13");
      expect(
        (view.getByLabelText("Deskohub status") as HTMLSelectElement).value
      ).toBe("");
      expect(form.querySelector('input[name="customerId"]')).toBeNull();
      entries = Array.from(new FormData(form).entries()).map(
        ([name, value]) => [name, String(value)]
      );
      expect(entries).toEqual([
        ["status", ""],
        ["type", ""],
        ["from", "2026-08-13"],
        ["to", ""],
        ["sort", "created"],
        ["direction", "desc"],
      ]);
      await expectNativeGetSubmission(form);
    } finally {
      Temporal.Now.instant = originalNow;
    }
  });

  test("places date shortcuts before right-aligned clear and apply actions", async () => {
    const originalNow = Temporal.Now.instant;
    Temporal.Now.instant = () => Temporal.Instant.from("2026-08-12T10:00:00Z");
    reservationPage = {
      input: {
        direction: "asc",
        from: "2026-08-04",
        sort: "date",
        status: "complete",
        to: "2026-08-10",
        type: "cowork",
      },
      result: defaultReservationPage.result,
    };

    try {
      const { ReservationsAdministrationContent } = await import("./page");
      const view = render(
        await ReservationsAdministrationContent({
          searchParams: Promise.resolve({}),
        })
      );
      const shortcuts = view.getByRole("navigation", {
        name: "Reservation date shortcuts",
      });
      const shortcutLinks = within(shortcuts).getAllByRole("link");

      expect(shortcutLinks.map((link) => link.textContent)).toEqual([
        "Today",
        "Upcoming",
        "Past",
      ]);
      expect(shortcutLinks.map((link) => link.getAttribute("href"))).toEqual([
        "/admin/reservations?direction=asc&from=2026-08-12&sort=date&status=complete&to=2026-08-12&type=cowork",
        "/admin/reservations?direction=asc&from=2026-08-13&sort=date&status=complete&type=cowork",
        "/admin/reservations?direction=asc&sort=date&status=complete&to=2026-08-11&type=cowork",
      ]);

      const actions = view.getByRole("group", { name: "Filter actions" });
      expect(actions.className).toContain("justify-end");
      expect(actions.textContent).toBe("ClearApply filters");
      expect(
        view.getByRole("link", { name: "Clear" }).getAttribute("href")
      ).toBe("/admin/reservations");
    } finally {
      Temporal.Now.instant = originalNow;
    }
  });

  test("shows the default open-ended range from January 1 without offering to clear it", async () => {
    const originalNow = Temporal.Now.instant;
    Temporal.Now.instant = () => Temporal.Instant.from("2026-08-12T10:00:00Z");
    reservationPage = {
      input: {
        direction: "desc",
        from: "2026-01-01",
        sort: "created",
      },
      result: { ...defaultReservationPage.result, pageCount: 2 },
    };

    try {
      const { ReservationsAdministrationContent } = await import("./page");
      const view = render(
        await ReservationsAdministrationContent({
          searchParams: Promise.resolve({}),
        })
      );

      expect(view.getByLabelText("Start date from").getAttribute("value")).toBe(
        "2026-01-01"
      );
      expect(view.getByLabelText("Start date to").getAttribute("value")).toBe(
        ""
      );
      expect(view.queryByRole("link", { name: "Clear" })).toBeNull();
      expect(
        view.getByRole("link", { name: "Next" }).getAttribute("href")
      ).toBe(
        "/admin/reservations?direction=desc&from=2026-01-01&sort=created&page=2"
      );
    } finally {
      Temporal.Now.instant = originalNow;
    }
  });

  test("offers to clear an end date added to the default range", async () => {
    const originalNow = Temporal.Now.instant;
    Temporal.Now.instant = () => Temporal.Instant.from("2026-08-12T10:00:00Z");
    reservationPage = {
      input: {
        direction: "desc",
        from: "2026-01-01",
        sort: "created",
        to: "2026-08-12",
      },
      result: defaultReservationPage.result,
    };

    try {
      const { ReservationsAdministrationContent } = await import("./page");
      const view = render(
        await ReservationsAdministrationContent({
          searchParams: Promise.resolve({}),
        })
      );

      expect(
        view.getByRole("link", { name: "Clear" }).getAttribute("href")
      ).toBe("/admin/reservations");
    } finally {
      Temporal.Now.instant = originalNow;
    }
  });

  test("shows a customer's complete history without a date range", async () => {
    reservationPage = {
      input: {
        customerId: "customer-one",
        direction: "desc",
        sort: "created",
      },
      result: defaultReservationPage.result,
    };
    const { ReservationsAdministrationContent } = await import("./page");
    const view = render(
      await ReservationsAdministrationContent({
        searchParams: Promise.resolve({ customerId: "customer-one" }),
      })
    );

    expect(view.getByLabelText("Start date from").getAttribute("value")).toBe(
      ""
    );
    expect(view.getByLabelText("Start date to").getAttribute("value")).toBe("");
    expect(
      view.getByRole("link", { name: "Clear customer" }).getAttribute("href")
    ).toBe("/admin/reservations?direction=desc&sort=created");
  });

  test("explains the fallback when provider date sorting is unavailable", async () => {
    reservationPage = {
      input: { direction: "asc", sort: "date" },
      result: {
        ...defaultReservationPage.result,
        dateSortUnavailable: true,
      },
    };
    const { ReservationsAdministrationContent } = await import("./page");
    const view = render(
      await ReservationsAdministrationContent({
        searchParams: Promise.resolve({ direction: "asc", sort: "date" }),
      })
    );

    expect(
      view.getByText(
        "Reservation dates are temporarily unavailable for sorting. Showing newest records instead."
      )
    ).toBeDefined();
  });
});
