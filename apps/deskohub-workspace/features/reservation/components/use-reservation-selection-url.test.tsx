import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useForm } from "react-hook-form";
import {
  type OfficeReservationInput,
  officeReservationDefaultValues,
} from "@/features/reservation/office-reservation";
import { officeSelectionLink } from "@/features/reservation/office-selection-link";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  useReservationSelectionUrl,
  useWatchedSelection,
} from "./use-reservation-selection-url";

const openedUrl =
  "https://workspace.test/en-US/reservation/office?startsOn=2099-06-12&dayCount=2&discountCode=SPRING";

type OfficeSelection = Parameters<typeof officeSelectionLink.write>[0];

const renderSelectionUrl = (initialSelection: OfficeSelection | undefined) =>
  renderHook(
    ({ selection }: { selection?: OfficeSelection }) =>
      useReservationSelectionUrl(officeSelectionLink, selection),
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

    renderSelectionUrl({ startsOn: "2099-06-20", dayCount: 3, seats: 1 });

    expect(replaceState).not.toHaveBeenCalled();
    expect(window.location.href).toBe(openedUrl);
    replaceState.mockRestore();
  });

  test("replaces the history entry with each edited selection", () => {
    const replaceState = openReservationPage();
    const historyLength = window.history.length;
    const { rerender } = renderSelectionUrl({
      startsOn: "2099-06-12",
      dayCount: 2,
      seats: 1,
    });

    rerender({
      selection: { startsOn: "2099-06-20", dayCount: 2, seats: 4 },
    });
    expect(window.location.search).toBe(
      "?startsOn=2099-06-20&dayCount=2&discountCode=SPRING&seats=4"
    );

    rerender({
      selection: { startsOn: "2099-06-20", dayCount: 2, seats: undefined },
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
      dayCount: 2,
      seats: 1,
    });

    rerender({ selection: undefined });
    expect(replaceState).not.toHaveBeenCalled();

    rerender({
      selection: { startsOn: "2099-06-12", dayCount: 5, seats: 1 },
    });
    expect(window.location.search).toBe(
      "?startsOn=2099-06-12&dayCount=5&discountCode=SPRING&seats=1"
    );
    replaceState.mockRestore();
  });

  test("mirrors the fields the link names as a form edits them", () => {
    const replaceState = openReservationPage();
    const { result } = renderHook(() => {
      const form = useForm<OfficeReservationInput>({
        defaultValues: {
          ...officeReservationDefaultValues,
          startsOn: "2099-06-12",
          dayCount: 2,
        },
      });
      useReservationSelectionUrl(
        officeSelectionLink,
        useWatchedSelection(officeSelectionLink, form.control)
      );
      return form;
    });
    expect(replaceState).not.toHaveBeenCalled();

    act(() => result.current.setValue("seats", 4));
    expect(window.location.search).toBe(
      "?startsOn=2099-06-12&dayCount=2&discountCode=SPRING&seats=4"
    );

    // Contact fields stay out of the link.
    act(() => result.current.setValue("name", "Ada Lovelace"));
    expect(replaceState).toHaveBeenCalledTimes(1);

    act(() => result.current.setValue("startsOn", ""));
    expect(window.location.search).toBe(
      "?dayCount=2&discountCode=SPRING&seats=4"
    );
    replaceState.mockRestore();
  });
});
