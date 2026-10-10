import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("server-only", () => ({}));

type SearchParams = Promise<
  Record<string, string | readonly string[] | undefined>
>;

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

const defaultBookings = {
  input: { date: "2026-08-10", direction: "desc", page: 1, sort: "status" },
  result: { items: [], page: 1, pageCount: 1, total: 0 },
};

let bookings = defaultBookings;
let receivedSearchParams: SearchParams | undefined;

mock.module("@/features/administration/page-data.server", () => ({
  loadAdministrationBookings: (searchParams: SearchParams) => {
    receivedSearchParams = searchParams;
    return Promise.resolve(bookings);
  },
  loadAdministrationBookingsPage: (searchParams: SearchParams) => {
    receivedSearchParams = searchParams;
    return {
      input: Promise.resolve(bookings.input),
      result: Promise.resolve(bookings.result),
    };
  },
}));

describe("BookingsAdministrationPage filters", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => {
    cleanup();
    bookings = defaultBookings;
    receivedSearchParams = undefined;
  });
  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await unregisterWorkspaceComponentTestEnv();
  });

  test("requires the server-selected date and retains hidden sorting in GET", async () => {
    const query = {
      date: "2026-08-10",
      direction: "desc",
      sort: "status",
    };
    const searchParams = Promise.resolve(query);
    const { BookingsAdministrationContent } = await import("./page");
    const view = render(await BookingsAdministrationContent({ searchParams }));
    const form = view.container.querySelector("form");
    const date = view.getByLabelText("Booking date");

    expect(await receivedSearchParams).toEqual(query);
    expect(form?.getAttribute("method")).toBe("get");
    expect(form?.getAttribute("action")).toBe("/admin/bookings");
    expect(date.getAttribute("value")).toBe("2026-08-10");
    expect(date.hasAttribute("required")).toBe(true);
    expect(
      Array.from(new FormData(form as HTMLFormElement).entries()).map(
        ([name, value]) => [name, String(value)]
      )
    ).toEqual([
      ["date", "2026-08-10"],
      ["sort", "status"],
      ["direction", "desc"],
    ]);
    await expectNativeGetSubmission(form as HTMLFormElement);
  });

  test("replaces dirty criteria with the new server selection before GET", async () => {
    const firstQuery = {
      date: "2026-08-10",
      direction: "desc",
      sort: "status",
    };
    const { BookingsAdministrationContent } = await import("./page");
    const view = render(
      await BookingsAdministrationContent({
        searchParams: Promise.resolve(firstQuery),
      })
    );
    const date = view.getByLabelText("Booking date") as HTMLInputElement;
    fireEvent.change(date, { target: { value: "2026-08-11" } });
    view.rerender(
      await BookingsAdministrationContent({
        searchParams: Promise.resolve(firstQuery),
      })
    );
    expect(date.value).toBe("2026-08-11");

    const nextQuery = {
      date: "2026-08-14",
      direction: "asc" as const,
      sort: "booking" as const,
    };
    bookings = {
      ...defaultBookings,
      input: { ...nextQuery, page: 1 },
    };
    view.rerender(
      await BookingsAdministrationContent({
        searchParams: Promise.resolve(nextQuery),
      })
    );

    expect(date.value).toBe("2026-08-14");
    const form = view.container.querySelector("form") as HTMLFormElement;
    expect(
      Array.from(new FormData(form).entries()).map(([name, value]) => [
        name,
        String(value),
      ])
    ).toEqual([
      ["date", "2026-08-14"],
      ["sort", "booking"],
      ["direction", "asc"],
    ]);
    await expectNativeGetSubmission(form);
  });
});
