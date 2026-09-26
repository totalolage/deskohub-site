import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const back = mock();

mock.module("next/navigation", () => ({
  useRouter: () => ({ back }),
}));

beforeAll(registerWorkspaceComponentTestEnv);

beforeEach(() => {
  back.mockClear();
});

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

test("renders an accessible modal and closes through browser history", async () => {
  const { ReservationDetailsModal } = await import(
    "./reservation-details-modal"
  );

  const view = render(
    <ReservationDetailsModal locale="en-US">
      <p>Reservation details</p>
    </ReservationDetailsModal>
  );

  expect(view.getByRole("dialog")).toBeDefined();
  expect(
    view.getByRole("heading", { name: "Reservation summary" })
  ).toBeDefined();
  expect(view.getByText("Reservation details")).toBeDefined();

  fireEvent.click(view.getByRole("button", { name: "Close" }));

  expect(back).toHaveBeenCalledTimes(1);
});
