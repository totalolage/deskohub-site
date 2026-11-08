import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  ReservationTypeInput,
  ReservationTypeOption,
} from "./reservation-type-input";

describe("ReservationTypeInput", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("keeps native radio behavior when illustrated presentation is enabled", () => {
    const onChange = mock(() => undefined);
    const view = render(
      <ReservationTypeInput
        aria-required="true"
        idPrefix="cowork-tier"
        name="entryTier"
        onChange={onChange}
        presentation="illustrated"
        value="open-space"
      >
        <ReservationTypeOption
          price="CZK 290 / day"
          title="Open Space"
          value="open-space"
        />
        <ReservationTypeOption
          price="CZK 410 / day"
          title="Reserved Desk"
          value="reserved-desk"
        />
        <ReservationTypeOption
          disabled
          price="CZK 410 / day"
          title="Workstation"
          value="workstation"
        />
      </ReservationTypeInput>
    );
    const openSpace = view.container.querySelector(
      "#cowork-tier-open-space"
    ) as HTMLInputElement;
    const reservedDesk = view.container.querySelector(
      "#cowork-tier-reserved-desk"
    ) as HTMLInputElement;
    const workstation = view.container.querySelector(
      "#cowork-tier-workstation"
    ) as HTMLInputElement;

    const radioGroup = view.getByRole("radiogroup");
    expect(radioGroup.getAttribute("data-reservation-type-presentation")).toBe(
      "illustrated"
    );
    expect(radioGroup.getAttribute("aria-required")).toBe("true");
    expect(openSpace.name).toBe("entryTier");
    expect(openSpace.checked).toBe(true);
    expect(reservedDesk.disabled).toBe(false);
    expect(workstation.disabled).toBe(true);

    fireEvent.click(workstation);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(reservedDesk);
    expect(onChange).toHaveBeenCalledWith("reserved-desk");
  });

  test("shows an option's illustration only in the illustrated presentation", () => {
    const options = (presentation?: "illustrated") => (
      <ReservationTypeInput
        onChange={() => undefined}
        presentation={presentation}
        value="open-space"
      >
        <ReservationTypeOption
          illustration={<svg data-testid="desk" />}
          price="CZK 290 / day"
          priceReady={false}
          title="Open Space"
          value="open-space"
        />
      </ReservationTypeInput>
    );
    const view = render(options("illustrated"));
    const illustration = () =>
      view.container.querySelector("[data-reservation-type-illustration]");

    expect(illustration()?.getAttribute("aria-hidden")).toBe("true");
    expect(
      illustration()?.querySelector('[data-testid="desk"]')
    ).not.toBeNull();
    expect(
      view.container
        .querySelector("[data-reservation-type-price]")
        ?.getAttribute("data-reservation-type-price-ready")
    ).toBe("false");

    view.rerender(options());
    expect(illustration()).toBeNull();
    expect(view.getByRole("radio").getAttribute("aria-labelledby")).toBe(
      "reservation-type-open-space-title reservation-type-open-space-price"
    );
  });

  test("requires the option group around an option", () => {
    const consoleError = console.error;
    console.error = () => undefined;
    try {
      expect(() =>
        render(
          <ReservationTypeOption price="CZK 290" title="Open" value="open" />
        )
      ).toThrow(
        "ReservationTypeOption must be used within ReservationTypeInput"
      );
    } finally {
      console.error = consoleError;
    }
  });
});
