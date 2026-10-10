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

const defaultOperations = {
  input: { channel: "BACKOFFICE", operationType: "REFUND" },
  range: {
    from: "2026-07-01",
    to: "2026-08-01",
    fromTime: "2026-07-01T22:00:00Z",
    toTime: "2026-08-01T22:00:00Z",
  },
  result: { items: [], providerAvailable: true, truncated: false },
};

let operations = defaultOperations;
let receivedSearchParams: SearchParams | undefined;

mock.module("@/features/administration/page-data.server", () => ({
  loadAdministrationOperations: (searchParams: SearchParams) => {
    receivedSearchParams = searchParams;
    return Promise.resolve(operations);
  },
  loadAdministrationOperationsPage: (searchParams: SearchParams) => {
    receivedSearchParams = searchParams;
    return {
      criteria: Promise.resolve({
        input: operations.input,
        range: operations.range,
      }),
      result: Promise.resolve(operations.result),
    };
  },
}));

describe("OperationsAdministrationPage filters", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => {
    cleanup();
    operations = defaultOperations;
    receivedSearchParams = undefined;
  });
  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await unregisterWorkspaceComponentTestEnv();
  });

  test("keeps inclusive date and provider filter values in the GET query", async () => {
    const query = {
      from: "2026-07-01",
      to: "2026-08-01",
      channel: "BACKOFFICE",
      operationType: "REFUND",
    };
    const searchParams = Promise.resolve(query);
    const { OperationsAdministrationContent } = await import("./page");
    const view = render(
      await OperationsAdministrationContent({ searchParams })
    );
    const form = view.container.querySelector("form");

    expect(await receivedSearchParams).toEqual(query);
    expect(form?.getAttribute("method")).toBe("get");
    expect(form?.getAttribute("action")).toBe("/admin/operations");
    expect(view.getByLabelText("From").getAttribute("value")).toBe(
      "2026-07-01"
    );
    expect(view.getByLabelText("To").getAttribute("value")).toBe("2026-08-01");
    expect((view.getByLabelText("Origin") as HTMLSelectElement).value).toBe(
      "BACKOFFICE"
    );
    expect((view.getByLabelText("Type") as HTMLSelectElement).value).toBe(
      "REFUND"
    );
    expect(
      Array.from(new FormData(form as HTMLFormElement).entries()).map(
        ([name, value]) => [name, String(value)]
      )
    ).toEqual([
      ["from", "2026-07-01"],
      ["to", "2026-08-01"],
      ["channel", "BACKOFFICE"],
      ["operationType", "REFUND"],
    ]);
    await expectNativeGetSubmission(form as HTMLFormElement);
  });

  test("uses changed server dates and provider criteria after navigation", async () => {
    const { OperationsAdministrationContent } = await import("./page");
    const firstQuery = {
      from: "2026-07-01",
      to: "2026-08-01",
      channel: "BACKOFFICE",
      operationType: "REFUND",
    };
    const view = render(
      await OperationsAdministrationContent({
        searchParams: Promise.resolve(firstQuery),
      })
    );
    const from = view.getByLabelText("From") as HTMLInputElement;
    const channel = view.getByLabelText("Origin") as HTMLSelectElement;
    fireEvent.change(from, { target: { value: "2026-07-02" } });
    fireEvent.change(channel, { target: { value: "ECOMMERCE" } });
    view.rerender(
      await OperationsAdministrationContent({
        searchParams: Promise.resolve(firstQuery),
      })
    );
    expect(from.value).toBe("2026-07-02");
    expect(channel.value).toBe("ECOMMERCE");

    const nextQuery = {
      from: "2026-07-03",
      to: "2026-08-03",
      channel: "ECOMMERCE" as const,
      operationType: "CAPTURE" as const,
    };
    operations = {
      input: {
        channel: nextQuery.channel,
        operationType: nextQuery.operationType,
      },
      range: {
        ...defaultOperations.range,
        from: nextQuery.from,
        to: nextQuery.to,
        fromTime: "2026-07-02T22:00:00Z",
        toTime: "2026-08-02T22:00:00Z",
      },
      result: defaultOperations.result,
    };
    view.rerender(
      await OperationsAdministrationContent({
        searchParams: Promise.resolve(nextQuery),
      })
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
    const form = view.container.querySelector("form") as HTMLFormElement;
    expect(
      Array.from(new FormData(form).entries()).map(([name, value]) => [
        name,
        String(value),
      ])
    ).toEqual([
      ["from", "2026-07-03"],
      ["to", "2026-08-03"],
      ["channel", "ECOMMERCE"],
      ["operationType", "CAPTURE"],
    ]);
    await expectNativeGetSubmission(form);
  });
});
