import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import "@/shared/polyfills/temporal";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();

const { TimeInput } = await import("./time-input");

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

const renderTimeInput = ({
  props = {},
  withName = true,
}: {
  readonly props?: Partial<Parameters<typeof TimeInput>[0]>;
  readonly withName?: boolean;
} = {}) => {
  const onChange = mock(() => undefined);
  const view = render(
    <form aria-label="Bound form">
      <TimeInput
        ariaLabel="Start time"
        ariaRequired={props?.required}
        defaultValue={props?.defaultValue}
        disabled={props?.disabled}
        id="startTime"
        maximum={props?.maximum}
        minimum={props?.minimum}
        name={withName ? "startTime" : undefined}
        onBlur={props?.onBlur}
        onChange={onChange}
        required={props?.required}
        timeStepMinutes={props?.timeStepMinutes}
        value={props?.value}
      />
    </form>
  );
  const form = view.getByRole("form", {
    name: "Bound form",
  }) as HTMLFormElement;
  const readHidden = () => [
    ...form.querySelectorAll<HTMLInputElement>('[name="startTime"]'),
  ];
  const readEditor = () =>
    view.getByLabelText("Start time") as HTMLInputElement;
  return { form, onChange, readEditor, readHidden, view };
};

describe("TimeInput", () => {
  test("renders the native time editor with minute steps by default", () => {
    const { readEditor, readHidden } = renderTimeInput({
      props: { defaultValue: "10:00" },
    });

    expect(readEditor().getAttribute("type")).toBe("time");
    expect(readHidden()[0].getAttribute("step")).toBe("60");
    expect(readEditor().value).toBe("10:00");
    expect(readEditor().getAttribute("name")).toBeNull();
    expect(readHidden()).toHaveLength(1);
    expect(readHidden()[0].value).toBe("10:00");
  });

  test("renders no submit field when unnamed", () => {
    const { form } = renderTimeInput({ withName: false });

    expect(
      form.querySelectorAll<HTMLInputElement>('[name="startTime"]')
    ).toHaveLength(0);
  });

  test("commits valid edits and keeps canonical state", () => {
    const { onChange, readEditor, readHidden } = renderTimeInput({
      props: { defaultValue: "10:00" },
    });

    fireEvent.input(readEditor(), { target: { value: "10:30" } });

    expect(readHidden()[0].value).toBe("10:30");
    expect(onChange).toHaveBeenCalledWith("10:30");
    expect(readEditor().value).toBe("10:30");
  });

  test("rejects values outside the step and reverts the editor", () => {
    const { onChange, readEditor, readHidden } = renderTimeInput({
      props: { defaultValue: "16:00", timeStepMinutes: 60 },
    });

    expect(readEditor().getAttribute("name")).toBeNull();
    expect(readHidden()[0].getAttribute("step")).toBe("3600");
    fireEvent.input(readEditor(), { target: { value: "17:30" } });

    expect(onChange).not.toHaveBeenCalled();
    expect(readHidden()[0].value).toBe("16:00");
    expect(readEditor().value).toBe("16:00");
  });

  test("rejects values outside the minimum and maximum", () => {
    const { onChange, readEditor, readHidden } = renderTimeInput({
      props: {
        defaultValue: "16:00",
        maximum: "17:00",
        minimum: "15:00",
      },
    });

    expect(readHidden()[0].getAttribute("min")).toBe("15:00");
    expect(readHidden()[0].getAttribute("max")).toBe("17:00");

    fireEvent.input(readEditor(), { target: { value: "14:00" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(readEditor().value).toBe("16:00");

    fireEvent.input(readEditor(), { target: { value: "18:00" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(readEditor().value).toBe("16:00");
  });

  test("preserves the committed value while the edit is incomplete", () => {
    const { onChange, readEditor, readHidden } = renderTimeInput({
      props: { defaultValue: "16:00" },
    });
    const editor = readEditor();

    Object.defineProperty(editor, "validity", {
      configurable: true,
      value: { valid: false, badInput: true },
    });
    fireEvent.input(editor, { target: { value: "" } });

    expect(readHidden()[0].value).toBe("16:00");
    expect(onChange).not.toHaveBeenCalled();
    expect(editor.value).toBe("");
  });

  test("clears back to an empty optional value when valid", () => {
    const { onChange, readEditor, readHidden } = renderTimeInput({
      props: { defaultValue: "16:00" },
    });

    fireEvent.input(readEditor(), { target: { value: "" } });

    expect(readHidden()[0].value).toBe("");
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  test("keeps a committed value when a required field is emptied", () => {
    const { form, onChange, readEditor, readHidden } = renderTimeInput({
      props: { defaultValue: "16:00", required: true },
    });

    expect(readHidden()[0].required).toBe(true);
    expect(form.checkValidity()).toBe(true);

    const editor = readEditor();
    Object.defineProperty(editor, "validity", {
      configurable: true,
      value: { valid: false, valueMissing: true },
    });
    fireEvent.input(editor, { target: { value: "" } });

    expect(onChange).not.toHaveBeenCalled();
    expect(readHidden()[0].value).toBe("16:00");
  });

  test("required blocks submission while empty", () => {
    const { form } = renderTimeInput({ props: { required: true } });

    expect(
      (
        form.querySelector<HTMLInputElement>(
          '[name="startTime"]'
        ) as HTMLInputElement
      ).required
    ).toBe(true);
    expect(form.checkValidity()).toBe(false);
  });

  test("controlled value ignores direct edits until rerendered", () => {
    const { onChange, readEditor, readHidden, view } = renderTimeInput({
      props: { value: "16:00" },
    });

    expect(readHidden()[0].value).toBe("16:00");

    fireEvent.input(readEditor(), { target: { value: "17:30" } });
    expect(onChange).toHaveBeenCalledWith("17:30");
    expect(readHidden()[0].value).toBe("16:00");

    view.rerender(
      <form aria-label="Bound form">
        <TimeInput
          ariaLabel="Start time"
          name="startTime"
          onChange={onChange}
          value="17:30"
        />
      </form>
    );
    expect(readHidden()[0].value).toBe("17:30");
  });

  test("returns to the default when the form resets", () => {
    const { form, readEditor, readHidden } = renderTimeInput({
      props: { defaultValue: "10:00" },
    });

    fireEvent.input(readEditor(), { target: { value: "12:45" } });
    expect(readHidden()[0].value).toBe("12:45");

    act(() => {
      form.reset();
    });

    expect(readHidden()[0].value).toBe("10:00");
    expect(readEditor().value).toBe("10:00");
  });

  test("propagates invalid and described-by semantics to the editor", () => {
    const { readEditor, view } = renderTimeInput();

    expect(readEditor().getAttribute("aria-invalid")).toBe("false");

    view.rerender(
      <form aria-label="Bound form">
        <TimeInput
          ariaDescribedBy="startTime-error"
          ariaInvalid
          ariaLabel="Start time"
          name="startTime"
        />
      </form>
    );

    expect(readEditor().getAttribute("aria-invalid")).toBe("true");
    expect(readEditor().getAttribute("aria-describedby")).toBe(
      "startTime-error"
    );
  });
});
