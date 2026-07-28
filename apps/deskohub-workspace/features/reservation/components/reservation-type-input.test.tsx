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

  test("keeps numeric values controlled and forwards radio field behavior", () => {
    const inputRef = mock(() => undefined);
    const onBlur = mock(() => undefined);
    const onChange = mock(() => undefined);
    const view = render(
      <ReservationTypeInput
        idPrefix="duration"
        inputRef={inputRef}
        name="durationMinutes"
        onBlur={onBlur}
        onChange={onChange}
        value={60}
      >
        <ReservationTypeOption price="CZK 300" title="One hour" value={60} />
        <ReservationTypeOption price="CZK 600" title="Four hours" value={240} />
        <ReservationTypeOption
          disabled
          price="CZK 1,000"
          title="One day"
          value={1440}
        />
      </ReservationTypeInput>
    );
    const oneHour = view.container.querySelector(
      "#duration-60"
    ) as HTMLInputElement;
    const fourHours = view.container.querySelector(
      "#duration-240"
    ) as HTMLInputElement;
    const oneDay = view.container.querySelector(
      "#duration-1440"
    ) as HTMLInputElement;

    expect(oneHour.checked).toBe(true);
    expect(fourHours.checked).toBe(false);
    expect(oneHour.name).toBe("durationMinutes");
    expect(inputRef).toHaveBeenCalled();

    fireEvent.click(fourHours);
    expect(onChange).toHaveBeenCalledWith(240);
    expect(typeof onChange.mock.calls[0]?.[0]).toBe("number");

    fireEvent.blur(fourHours);
    expect(onBlur).toHaveBeenCalledTimes(1);

    fireEvent.click(oneDay);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(oneDay.disabled).toBe(true);
    expect(
      view.container.querySelector('[data-reservation-type-option="1440"]')
        ?.className
    ).toContain("cursor-not-allowed");
  });

  test("renders the shared discount treatment around caller-owned content", () => {
    const view = render(
      <ReservationTypeInput onChange={() => undefined} value="basic">
        <ReservationTypeOption
          discount={{
            labels: [{ id: "summer-sale", label: "Summer sale" }],
            details: <button type="button">Discount details</button>,
          }}
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

    expect(option?.className).toContain("outline-purple-500");
    expect(
      option?.querySelector('[data-reservation-type-discount="summer-sale"]')
        ?.textContent
    ).toBe("Summer sale");
    expect(
      option?.querySelector("[data-reservation-type-sale-glimmer-beam]")
    ).not.toBeNull();
    expect(
      option?.querySelector("[data-domain-description]")?.textContent
    ).toBe("Open-space desk");
    expect(
      view.getByRole("button", { name: "Discount details" })
    ).toBeDefined();
  });
});
