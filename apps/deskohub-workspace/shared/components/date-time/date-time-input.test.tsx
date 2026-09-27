import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import "@/shared/polyfills/temporal";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();

const { DateTimeInput } = await import("./date-time-input");

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

const today = Temporal.Now.plainDateISO();
const dayInCurrentMonth = (day: number) => today.with({ day });

const renderDateTimeInput = ({
  props = {},
  withName = true,
}: {
  readonly props?: Partial<Parameters<typeof DateTimeInput>[0]>;
  readonly withName?: boolean;
} = {}) => {
  const onChange = mock(() => undefined);
  const view = render(
    <form aria-label="Bound form">
      <DateTimeInput
        dateLabel="Start date"
        defaultValue={props?.defaultValue}
        id="startsAt"
        locale="en-US"
        maximum={props?.maximum}
        minimum={props?.minimum}
        name={withName ? "startsAt" : undefined}
        onChange={onChange}
        required={props?.required}
        timeLabel="Start time"
        timeStepMinutes={props?.timeStepMinutes}
        value={props?.value}
      />
    </form>
  );
  const form = view.getByRole("form", {
    name: "Bound form",
  }) as HTMLFormElement;
  const readHidden = () => [
    ...form.querySelectorAll<HTMLInputElement>('[name="startsAt"]'),
  ];
  return { form, onChange, readHidden, view };
};

const pickDate = async (
  view: ReturnType<typeof renderDateTimeInput>["view"],
  day: string
) => {
  fireEvent.click(view.getByRole("button", { name: "Start date" }));
  await view.findByRole("grid");
  const dayButton = [
    ...view.baseElement.querySelectorAll<HTMLButtonElement>(
      '[role="grid"] button'
    ),
  ].find((button) => button.textContent === day && !button.disabled);
  expect(dayButton).toBeDefined();
  fireEvent.click(dayButton!);
};

describe("DateTimeInput", () => {
  test("renders exactly one named submit field and both controls", () => {
    const { readHidden, view } = renderDateTimeInput({
      props: { defaultValue: "2099-06-10T16:00" },
    });

    expect(readHidden()).toHaveLength(1);
    expect(readHidden()[0].getAttribute("type")).toBe("datetime-local");
    expect(readHidden()[0].value).toBe("2099-06-10T16:00");
    expect(view.getByRole("button", { name: "Start date" })).toBeDefined();
    expect(view.getByLabelText("Start time")).toBeDefined();
    expect(
      view.baseElement.querySelectorAll('input[type="time"]')
    ).toHaveLength(1);
  });

  test("renders no submit field when unnamed", () => {
    const { form } = renderDateTimeInput({ withName: false });

    expect(
      form.querySelectorAll<HTMLInputElement>('[name="startsAt"]')
    ).toHaveLength(0);
  });

  test("submits a complete canonical datetime through FormData", async () => {
    const target = dayInCurrentMonth(15);
    const { form, onChange, readHidden, view } = renderDateTimeInput();

    expect(new FormData(form).get("startsAt")).toBe("");

    await pickDate(view, "15");
    expect(readHidden()[0].value).toBe("");
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.input(view.getByLabelText("Start time"), {
      target: { value: "10:30" },
    });

    const complete = `${target.toString()}T10:30`;
    expect(readHidden()[0].value).toBe(complete);
    expect(new FormData(form).get("startsAt")).toBe(complete);
    expect(onChange).toHaveBeenCalledWith(complete);
  });

  test("required blocks submission while incomplete", async () => {
    const { form, view } = renderDateTimeInput({ props: { required: true } });

    expect(
      (
        form.querySelector<HTMLInputElement>(
          '[name="startsAt"]'
        ) as HTMLInputElement
      ).required
    ).toBe(true);
    expect(form.checkValidity()).toBe(false);

    await pickDate(view, "15");
    expect(form.checkValidity()).toBe(false);

    fireEvent.input(view.getByLabelText("Start time"), {
      target: { value: "10:30" },
    });
    expect(form.checkValidity()).toBe(true);
  });

  test("passes date and same-day time bounds down", () => {
    const { readHidden, view } = renderDateTimeInput({
      props: { defaultValue: "2099-06-10T16:00", minimum: "2099-06-10T15:00" },
    });

    expect(readHidden()[0].getAttribute("min")).toBe("2099-06-10T15:00");
    const timeInput = view.getByLabelText("Start time");
    expect(timeInput.getAttribute("min")).toBeNull();
    const dateTrigger = view.getByRole("button", { name: "Start date" });
    expect(dateTrigger).toBeDefined();
  });

  test("rejects same-day times before the minimum", () => {
    const { onChange, view } = renderDateTimeInput({
      props: { defaultValue: "2099-06-10T16:00", minimum: "2099-06-10T15:00" },
    });
    const timeInput = view.getByLabelText("Start time");

    fireEvent.input(timeInput, { target: { value: "14:00" } });

    expect(onChange).not.toHaveBeenCalled();
    expect((timeInput as HTMLInputElement).value).toBe("16:00");
  });

  test("controlled value ignores edits until rerendered", () => {
    const { onChange, readHidden, view } = renderDateTimeInput({
      props: { value: "2099-06-10T16:00" },
    });

    fireEvent.input(view.getByLabelText("Start time"), {
      target: { value: "17:30" },
    });
    expect(onChange).toHaveBeenCalledWith("2099-06-10T17:30");
    expect(readHidden()[0].value).toBe("2099-06-10T16:00");

    view.rerender(
      <form aria-label="Bound form">
        <DateTimeInput
          dateLabel="Start date"
          locale="en-US"
          name="startsAt"
          onChange={onChange}
          timeLabel="Start time"
          value="2099-06-10T17:30"
        />
      </form>
    );
    expect(readHidden()[0].value).toBe("2099-06-10T17:30");
  });

  test("returns to the default when the form resets", async () => {
    const { form, readHidden, view } = renderDateTimeInput({
      props: { defaultValue: "2099-06-10T16:00" },
    });

    fireEvent.input(view.getByLabelText("Start time"), {
      target: { value: "18:00" },
    });
    expect(readHidden()[0].value).toBe("2099-06-10T18:00");

    act(() => {
      form.reset();
    });

    expect(readHidden()[0].value).toBe("2099-06-10T16:00");
    expect((view.getByLabelText("Start time") as HTMLInputElement).value).toBe(
      "16:00"
    );
  });

  test("clears the time to an incomplete state without emitting a value", () => {
    const { onChange, readHidden, view } = renderDateTimeInput({
      props: { defaultValue: "2099-06-10T16:00" },
    });

    fireEvent.input(view.getByLabelText("Start time"), {
      target: { value: "" },
    });

    expect(readHidden()[0].value).toBe("");
    expect(onChange).not.toHaveBeenCalled();
    expect((view.getByLabelText("Start time") as HTMLInputElement).value).toBe(
      ""
    );
  });

  test("applies time steps", () => {
    const { onChange, readHidden, view } = renderDateTimeInput({
      props: {
        defaultValue: "2099-06-10T16:00",
        timeStepMinutes: 60,
      },
    });
    const timeInput = view.getByLabelText("Start time");

    expect(readHidden()[0].getAttribute("step")).toBe("3600");
    fireEvent.input(timeInput, { target: { value: "17:30" } });
    expect(onChange).not.toHaveBeenCalled();
    expect((timeInput as HTMLInputElement).value).toBe("16:00");
  });
});
