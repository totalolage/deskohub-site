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

const defaultOrders = {
  range: {
    from: "2026-08-03",
    to: "2026-08-10",
    fromTime: "2026-08-03T22:00:00Z",
    toTime: "2026-08-10T22:00:00Z",
  },
  result: { items: [], providerAvailable: true, truncated: false },
};

let orders = defaultOrders;
let receivedSearchParams: SearchParams | undefined;

mock.module("@/features/administration/page-data.server", () => ({
  loadAdministrationOrders: (searchParams: SearchParams) => {
    receivedSearchParams = searchParams;
    return Promise.resolve(orders);
  },
  loadAdministrationOrdersPage: (searchParams: SearchParams) => {
    receivedSearchParams = searchParams;
    return {
      range: Promise.resolve(orders.range),
      result: Promise.resolve(orders.result),
    };
  },
}));

describe("OrdersAdministrationPage filters", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => {
    cleanup();
    orders = defaultOrders;
    receivedSearchParams = undefined;
  });
  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await unregisterWorkspaceComponentTestEnv();
  });

  test("uses server date defaults and submits the exact date fields as GET", async () => {
    const query = { from: "2026-08-03", to: "2026-08-10" };
    const searchParams = Promise.resolve(query);
    const { OrdersAdministrationContent } = await import("./page");
    const view = render(await OrdersAdministrationContent({ searchParams }));
    const form = view.container.querySelector("form");

    expect(await receivedSearchParams).toEqual(query);
    expect(form?.getAttribute("method")).toBe("get");
    expect(form?.getAttribute("action")).toBe("/admin/orders");
    expect(view.getByLabelText("From").getAttribute("value")).toBe(
      "2026-08-03"
    );
    expect(view.getByLabelText("To").getAttribute("value")).toBe("2026-08-10");
    expect(Array.from(new FormData(form as HTMLFormElement).keys())).toEqual([
      "from",
      "to",
    ]);
    await expectNativeGetSubmission(form as HTMLFormElement);
  });

  test("replaces dirty dates with the new server range before GET", async () => {
    const { OrdersAdministrationContent } = await import("./page");
    const firstRange = { from: "2026-08-03", to: "2026-08-10" };
    const view = render(
      await OrdersAdministrationContent({
        searchParams: Promise.resolve(firstRange),
      })
    );
    const from = view.getByLabelText("From") as HTMLInputElement;
    const to = view.getByLabelText("To") as HTMLInputElement;
    fireEvent.change(from, { target: { value: "2026-08-04" } });
    fireEvent.change(to, { target: { value: "2026-08-11" } });
    view.rerender(
      await OrdersAdministrationContent({
        searchParams: Promise.resolve(firstRange),
      })
    );
    expect(from.value).toBe("2026-08-04");
    expect(to.value).toBe("2026-08-11");

    const nextRange = { from: "2026-08-05", to: "2026-08-12" };
    orders = {
      range: {
        ...defaultOrders.range,
        ...nextRange,
        fromTime: "2026-08-04T22:00:00Z",
        toTime: "2026-08-11T22:00:00Z",
      },
      result: defaultOrders.result,
    };
    view.rerender(
      await OrdersAdministrationContent({
        searchParams: Promise.resolve(nextRange),
      })
    );

    expect(from.value).toBe("2026-08-05");
    expect(to.value).toBe("2026-08-12");
    const form = view.container.querySelector("form") as HTMLFormElement;
    expect(Array.from(new FormData(form).entries())).toEqual([
      ["from", "2026-08-05"],
      ["to", "2026-08-12"],
    ]);
    await expectNativeGetSubmission(form);
  });
});
