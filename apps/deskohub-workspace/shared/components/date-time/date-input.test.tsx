import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import "@/shared/polyfills/temporal";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();

const { DateInput } = await import("./date-input");

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

const today = Temporal.Now.plainDateISO();
const dayInCurrentMonth = (day: number) => today.with({ day });

const renderDateInput = ({
  props = {},
  withName = true,
}: {
  readonly props?: Partial<Parameters<typeof DateInput>[0]>;
  readonly withName?: boolean;
} = {}) => {
  const onChange = mock(() => undefined);
  const view = render(
    <form aria-label="Bound form">
      <DateInput
        ariaLabel="Start date"
        defaultValue={props?.defaultValue}
        disabled={props?.disabled}
        id="startDate"
        isDateDisabled={props?.isDateDisabled}
        locale="en-US"
        maximum={props?.maximum}
        minimum={props?.minimum}
        name={withName ? "startDate" : undefined}
        onChange={onChange}
        placeholder={props?.placeholder}
        required={props?.required}
        value={props?.value}
      />
    </form>
  );
  const form = view.getByRole("form", {
    name: "Bound form",
  }) as HTMLFormElement;
  const readHidden = () => [
    ...form.querySelectorAll<HTMLInputElement>('[name="startDate"]'),
  ];
  return { form, onChange, readHidden, view };
};

const openCalendar = async (
  view: ReturnType<typeof renderDateInput>["view"]
) => {
  fireEvent.click(view.getByRole("button", { name: "Start date" }));
  await view.findByRole("grid");
};

const clickDay = (
  view: ReturnType<typeof renderDateInput>["view"],
  day: string
) => {
  const dayButton = [
    ...view.baseElement.querySelectorAll<HTMLButtonElement>(
      '[role="grid"] button'
    ),
  ].find((button) => button.textContent === day && !button.disabled);
  expect(dayButton).toBeDefined();
  fireEvent.click(dayButton!);
};

describe("DateInput", () => {
  test("renders the placeholder trigger and a validated native field when named", () => {
    const { form, readHidden, view } = renderDateInput();

    expect(view.getByRole("button", { name: "Start date" }).textContent).toBe(
      "Pick a date"
    );
    expect(readHidden()).toHaveLength(1);
    expect(readHidden()[0].getAttribute("type")).toBe("date");
    expect(readHidden()[0].value).toBe("");
    expect(readHidden()[0].getAttribute("name")).toBe("startDate");
    expect(new FormData(form).get("startDate")).toBe("");
  });

  test("renders no submit field when unnamed", () => {
    const { form, view } = renderDateInput({ withName: false });

    expect(
      form.querySelectorAll<HTMLInputElement>('[name="startDate"]')
    ).toHaveLength(0);
    expect(view.getByRole("button", { name: "Start date" })).toBeDefined();
  });

  test("selects a date from the calendar and closes the popover", async () => {
    const target = dayInCurrentMonth(15);
    const { form, onChange, readHidden, view } = renderDateInput();

    await openCalendar(view);
    clickDay(view, "15");
    await waitFor(() => expect(view.queryByRole("grid")).toBeNull());

    expect(readHidden()[0].value).toBe(target.toString());
    expect(new FormData(form).get("startDate")).toBe(target.toString());
    expect(onChange).toHaveBeenCalledWith(target.toString());
    expect(
      view.getByRole("button", { name: "Start date" }).textContent
    ).toContain("15");
  });

  test("validates an unnamed required control without naming it", async () => {
    const { form, view } = renderDateInput({
      props: { required: true },
      withName: false,
    });
    const canonical =
      form.querySelector<HTMLInputElement>('input[type="date"]')!;

    expect(canonical.name).toBe("");
    expect(canonical.required).toBe(true);
    expect(form.checkValidity()).toBe(false);
    expect(new FormData(form).get("startDate")).toBeNull();

    await openCalendar(view);
    clickDay(view, "15");
    expect(form.checkValidity()).toBe(true);
    expect(new FormData(form).get("startDate")).toBeNull();
  });

  test("re-checks dynamic bounds at selection time", async () => {
    let minimum = dayInCurrentMonth(1).toString();
    const { view } = renderDateInput({
      props: { minimum: () => minimum },
    });

    // The calendar opens under the old bound; the bound then advances past
    // the enabled day without a rerender and the fresh event-time bound
    // rejects the selection.
    await openCalendar(view);
    minimum = dayInCurrentMonth(20).toString();
    clickDay(view, "15");

    expect(
      view.getByRole("button", { name: "Start date" }).textContent
    ).toContain("Pick a date");
  });

  test("does not select a calendar day when disabled while the popover is open", async () => {
    const onChange = mock(() => undefined);
    const renderInput = (disabled: boolean) => (
      <form aria-label="Bound form">
        <DateInput
          ariaLabel="Start date"
          disabled={disabled}
          locale="en-US"
          name="startDate"
          onChange={onChange}
        />
      </form>
    );
    const view = render(renderInput(false));

    await openCalendar(view);
    view.rerender(renderInput(true));

    const currentMonth = dayInCurrentMonth(15).toLocaleString("en-US", {
      month: "long",
    });
    const dayButton = [
      ...view.baseElement.querySelectorAll<HTMLButtonElement>(
        '[role="grid"] button'
      ),
    ].find(
      (button) =>
        button.textContent === "15" &&
        (button.getAttribute("aria-label") ?? "").includes(currentMonth) &&
        (button.getAttribute("aria-label") ?? "").includes(String(today.year))
    );
    expect(dayButton).toBeDefined();
    fireEvent.click(dayButton!);

    expect(onChange).not.toHaveBeenCalled();
    expect(dayButton!.disabled).toBe(true);
    expect(
      view.container.querySelector<HTMLInputElement>('[name="startDate"]')!
        .value
    ).toBe("");
  });

  test("treats malformed and non-canonical prop values as empty", () => {
    const { readHidden, view } = renderDateInput({
      props: { value: "2099-06-10T16:00" },
    });

    expect(readHidden()[0].value).toBe("");
    expect(view.getByRole("button", { name: "Start date" }).textContent).toBe(
      "Pick a date"
    );

    view.rerender(
      <form aria-label="Bound form">
        <DateInput
          ariaLabel="Start date"
          locale="en-US"
          name="startDate"
          value="June 10th, 2099"
        />
      </form>
    );
    expect(readHidden()[0].value).toBe("");
  });

  test("exposes a ref, blur, and label association on the date trigger", () => {
    let triggerRef: HTMLButtonElement | null = null;
    const onBlur = mock(() => undefined);
    const view = render(
      <form aria-label="Bound form">
        <label htmlFor="startDate">Start date label</label>
        <DateInput
          ariaLabel="Start date"
          id="startDate"
          locale="en-US"
          onBlur={onBlur}
          ref={(node) => {
            triggerRef = node;
          }}
        />
      </form>
    );
    const trigger = view.getByLabelText(
      "Start date label"
    ) as HTMLButtonElement;

    // The label targets the interactive trigger, and the ref exposes it.
    expect(trigger).toBeInstanceOf(HTMLButtonElement);
    expect(triggerRef).toBeInstanceOf(HTMLButtonElement);
    expect(triggerRef!.id).toBe("startDate");

    trigger.focus();
    expect(view.container.ownerDocument.activeElement).toBe(trigger);
    fireEvent.blur(trigger);
    expect(onBlur).toHaveBeenCalled();
  });

  test("wraps long localized dates instead of truncating", () => {
    const { view } = renderDateInput({
      props: { value: "2099-06-10" },
    });
    const trigger = view.getByRole("button", { name: "Start date" });

    expect(trigger.className).toContain("whitespace-normal");
    expect(trigger.textContent).toContain("June 10, 2099");
  });

  test("clears back to an empty canonical value", async () => {
    const { onChange, readHidden, view } = renderDateInput({
      props: { defaultValue: "2099-06-10" },
    });

    await openCalendar(view);
    fireEvent.click(view.getByRole("button", { name: "Clear Start date" }));

    expect(readHidden()[0].value).toBe("");
    expect(onChange).toHaveBeenCalledWith(undefined);
    expect(view.getByRole("button", { name: "Start date" }).textContent).toBe(
      "Pick a date"
    );
  });

  test("controlled value ignores direct selection until rerendered", async () => {
    const target = dayInCurrentMonth(15);
    const { onChange, readHidden, view } = renderDateInput({
      props: { value: "2099-06-10" },
    });

    expect(readHidden()[0].value).toBe("2099-06-10");

    await openCalendar(view);
    clickDay(view, "15");

    expect(onChange).toHaveBeenCalledWith(target.toString());
    expect(readHidden()[0].value).toBe("2099-06-10");

    view.rerender(
      <form aria-label="Bound form">
        <DateInput
          ariaLabel="Start date"
          locale="en-US"
          name="startDate"
          onChange={onChange}
          value={target.toString()}
        />
      </form>
    );
    expect(readHidden()[0].value).toBe(target.toString());
  });

  test("returns to the default when the form resets", async () => {
    const { form, readHidden, view } = renderDateInput({
      props: { defaultValue: "2099-06-10" },
    });

    await openCalendar(view);
    clickDay(view, "15");
    expect(readHidden()[0].value).toBe(dayInCurrentMonth(15).toString());

    act(() => {
      form.reset();
    });

    expect(readHidden()[0].value).toBe("2099-06-10");
  });

  test("required blocks submission while empty and passes once set", async () => {
    const { form, view } = renderDateInput({ props: { required: true } });

    expect(
      (
        form.querySelector<HTMLInputElement>(
          '[name="startDate"]'
        ) as HTMLInputElement
      ).required
    ).toBe(true);
    expect(form.checkValidity()).toBe(false);

    await openCalendar(view);
    clickDay(view, "15");

    expect(form.checkValidity()).toBe(true);
  });

  test("respects minimum and maximum bounds natively and in the calendar", async () => {
    const minimum = dayInCurrentMonth(10);
    const maximum = dayInCurrentMonth(20);
    const { form, readHidden, view } = renderDateInput({
      props: { maximum: maximum.toString(), minimum: minimum.toString() },
    });

    expect(readHidden()[0].getAttribute("min")).toBe(minimum.toString());
    expect(readHidden()[0].getAttribute("max")).toBe(maximum.toString());

    await openCalendar(view);
    const dayButtons = [
      ...view.baseElement.querySelectorAll<HTMLButtonElement>(
        '[role="grid"] button'
      ),
    ].filter(
      (button) => button.textContent === "9" || button.textContent === "21"
    );
    expect(
      dayButtons
        .filter((button) => button.textContent === "9")
        .every((button) => button.disabled)
    ).toBe(true);
    expect(
      dayButtons
        .filter((button) => button.textContent === "21")
        .every((button) => button.disabled)
    ).toBe(true);
    expect(form.checkValidity()).toBe(true);
  });

  test("disables dates through the predicate", async () => {
    const { view } = renderDateInput({
      props: {
        isDateDisabled: (date: Temporal.PlainDate) => date.day === 15,
      },
    });

    await openCalendar(view);
    const fifteenth = [
      ...view.baseElement.querySelectorAll<HTMLButtonElement>(
        '[role="grid"] button'
      ),
    ].filter((button) => button.textContent === "15");
    expect(fifteenth).not.toHaveLength(0);
    expect(fifteenth.every((button) => button.disabled)).toBe(true);
  });

  test("propagates invalid and described-by semantics to the trigger", () => {
    const { view } = renderDateInput({
      props: { required: true },
    });
    const trigger = view.getByRole("button", { name: "Start date" });

    expect(trigger.getAttribute("aria-invalid")).toBe("false");
    expect(trigger.getAttribute("aria-describedby")).toBeNull();

    view.rerender(
      <form aria-label="Bound form">
        <DateInput
          ariaDescribedBy="startDate-error"
          ariaInvalid
          ariaLabel="Start date"
          locale="en-US"
          name="startDate"
          required
        />
      </form>
    );

    expect(
      view
        .getByRole("button", { name: "Start date" })
        .getAttribute("aria-invalid")
    ).toBe("true");
    expect(
      view
        .getByRole("button", { name: "Start date" })
        .getAttribute("aria-describedby")
    ).toBe("startDate-error");
  });
});
