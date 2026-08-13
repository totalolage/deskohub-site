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

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("keeps semantic values controlled and forwards radio field behavior", () => {
    const inputRef = mock(() => undefined);
    const onBlur = mock(() => undefined);
    const onChange = mock(() => undefined);
    const view = render(
      <ReservationTypeInput
        idPrefix="duration"
        inputRef={inputRef}
        name="duration"
        onBlur={onBlur}
        onChange={onChange}
        value="hour:1"
      >
        <ReservationTypeOption
          price="CZK 300"
          title="One hour"
          value="hour:1"
        />
        <ReservationTypeOption
          price="CZK 600"
          title="Four hours"
          value="hour:4"
        />
        <ReservationTypeOption
          disabled
          price="CZK 1,000"
          title="Whole day"
          value="day:1"
        />
      </ReservationTypeInput>
    );
    const oneHour = view.container.querySelector(
      "#duration-hour\\:1"
    ) as HTMLInputElement;
    const fourHours = view.container.querySelector(
      "#duration-hour\\:4"
    ) as HTMLInputElement;
    const oneDay = view.container.querySelector(
      "#duration-day\\:1"
    ) as HTMLInputElement;

    expect(oneHour.checked).toBe(true);
    expect(fourHours.checked).toBe(false);
    expect(oneHour.name).toBe("duration");
    expect(inputRef).toHaveBeenCalled();

    fireEvent.click(
      view.container.querySelector(
        '[data-reservation-type-title="hour:4"]'
      ) as HTMLElement
    );
    expect(onChange).toHaveBeenCalledWith("hour:4");

    fireEvent.click(
      view.container.querySelector(
        '[data-reservation-type-price="hour:4"]'
      ) as HTMLElement
    );
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith("hour:4");

    fireEvent.blur(fourHours);
    expect(onBlur).toHaveBeenCalledTimes(1);

    fireEvent.click(
      view.container.querySelector(
        '[data-reservation-type-title="day:1"]'
      ) as HTMLElement
    );
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(oneDay.disabled).toBe(true);
    expect(
      view.container.querySelector('[data-reservation-type-option="day:1"]')
        ?.className
    ).toContain("cursor-not-allowed");
  });

  test("renders caller-owned content without pricing campaign state", () => {
    const view = render(
      <ReservationTypeInput onChange={() => undefined} value="basic">
        <ReservationTypeOption
          price="CZK 175 / day"
          title="Basic"
          value="basic"
        >
          <div data-domain-description="">Open-space desk</div>
        </ReservationTypeOption>
      </ReservationTypeInput>
    );
    const option = view.container.querySelector(
      '[data-reservation-type-option="basic"]'
    );

    expect(option?.className).toContain("outline-burned-orange");
    expect(option?.className).toContain("lg:row-span-4");
    expect(option?.className).not.toContain("glow-border");
    expect(
      option?.querySelector("[data-domain-description]")?.textContent
    ).toBe("Open-space desk");
  });
});
