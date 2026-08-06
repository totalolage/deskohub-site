import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { officeReservationDefaultValues } from "@/features/reservation/office-reservation";
import {
  workspaceUseAction,
  workspaceUseSearchParams,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const execute = mock(() => undefined);

mock.module("@/features/cookie-consent", () => ({
  useCookieConsent: () => ({ isAccepted: () => false }),
}));

mock.module("@/features/reservation/actions/get-advertised-price", () => ({
  getAdvertisedPrices: () => Promise.resolve({ data: [] }),
}));

const { OfficeReservationForm } = await import("./office-reservation-form");

describe("OfficeReservationForm", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  beforeEach(() => {
    workspaceUseSearchParams.mockReturnValue(new URLSearchParams());
    workspaceUseAction.mockReturnValue({
      execute,
      isExecuting: false,
      result: {},
    });
  });

  afterEach(() => {
    cleanup();
    execute.mockClear();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("renders the date range as an accessible field group", () => {
    const queryClient = new QueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <OfficeReservationForm
          initialValues={officeReservationDefaultValues}
          locale="en-US"
        />
      </QueryClientProvider>
    );

    expect(
      view.getByRole("group", { name: "Reservation dates" })
    ).toBeDefined();
  });

  test("keeps the additional-people input compact", () => {
    const queryClient = new QueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <OfficeReservationForm
          initialValues={officeReservationDefaultValues}
          locale="en-US"
        />
      </QueryClientProvider>
    );

    expect(
      view.getByRole("spinbutton", {
        name: "How many other people will use the office?",
      }).className
    ).toContain("w-28");
  });
});
