import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import { cleanup, renderHook } from "@testing-library/react";
import type { ReservationSelectionSearchParams } from "@/features/reservation/reservation-checkout-query";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { useReservationSelectionUrl } from "./use-reservation-selection-url";

const openedUrl =
  "https://workspace.test/en-US/reservation/office?startsOn=2099-06-12&dayCount=2&discountCode=SPRING";

const renderSelectionUrl = (
  initialSelection: ReservationSelectionSearchParams | undefined
) =>
  renderHook(
    ({ selection }: { selection?: ReservationSelectionSearchParams }) =>
      useReservationSelectionUrl(selection),
    { initialProps: { selection: initialSelection } }
  );

describe("useReservationSelectionUrl", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  const openReservationPage = () => {
    window.happyDOM.setURL(openedUrl);
    return spyOn(window.history, "replaceState");
  };

  test("leaves the URL the page opened with alone", () => {
    const replaceState = openReservationPage();

    renderSelectionUrl({ startsOn: "2099-06-20", dayCount: "3", seats: "1" });

    expect(replaceState).not.toHaveBeenCalled();
    expect(window.location.href).toBe(openedUrl);
    replaceState.mockRestore();
  });

  test("replaces the history entry with each edited selection", () => {
    const replaceState = openReservationPage();
    const historyLength = window.history.length;
    const { rerender } = renderSelectionUrl({
      startsOn: "2099-06-12",
      dayCount: "2",
      seats: "1",
    });

    rerender({
      selection: { startsOn: "2099-06-20", dayCount: "2", seats: "4" },
    });
    expect(window.location.search).toBe(
      "?startsOn=2099-06-20&dayCount=2&discountCode=SPRING&seats=4"
    );

    rerender({
      selection: { startsOn: "2099-06-20", dayCount: "2", seats: undefined },
    });
    expect(window.location.search).toBe(
      "?startsOn=2099-06-20&dayCount=2&discountCode=SPRING"
    );

    expect(replaceState).toHaveBeenCalledTimes(2);
    expect(window.history.length).toBe(historyLength);
    replaceState.mockRestore();
  });

  test("waits for a complete selection", () => {
    const replaceState = openReservationPage();
    const { rerender } = renderSelectionUrl({
      startsOn: "2099-06-12",
      dayCount: "2",
      seats: "1",
    });

    rerender({ selection: undefined });
    expect(replaceState).not.toHaveBeenCalled();

    rerender({
      selection: { startsOn: "2099-06-12", dayCount: "5", seats: "1" },
    });
    expect(window.location.search).toBe(
      "?startsOn=2099-06-12&dayCount=5&discountCode=SPRING&seats=1"
    );
    replaceState.mockRestore();
  });
});
