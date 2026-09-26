import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();

const { TemporalInput } = await import("./temporal-input");

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

const renderBounded = (props?: {
  readonly defaultValue?: string;
  readonly type?: "date" | "datetime-local";
}) => {
  const view = render(
    <form aria-label="Bound form">
      <label htmlFor="validFrom">Valid from</label>
      <TemporalInput
        defaultValue={props?.defaultValue}
        id="validFrom"
        label="Valid from"
        name="validFrom"
        type={props?.type ?? "datetime-local"}
      />
    </form>
  );
  const form = view.getByRole("form", {
    name: "Bound form",
  }) as HTMLFormElement;
  const readBound = () => [
    ...form.querySelectorAll<HTMLInputElement>('[name="validFrom"]'),
  ];
  return { form, readBound, view };
};

describe("TemporalInput", () => {
  test("renders an empty unbound display for missing values", () => {
    const { readBound, view } = renderBounded();

    expect(readBound()).toHaveLength(1);
    expect(readBound()[0].value).toBe("");
    expect(view.getByRole("button", { name: "Valid from" }).textContent).toBe(
      "Not set"
    );
    expect(view.getByLabelText("Valid from").id).toBe("validFrom");
    expect(view.getByLabelText("Valid from").getAttribute("type")).toBe(
      "button"
    );
  });

  test("shows populated date and time segments on separate lines", () => {
    const { readBound, view } = renderBounded({
      defaultValue: "2026-08-01T10:00",
    });

    const trigger = view.getByRole("button", { name: "Valid from" });
    expect(trigger.textContent).toContain("2026-08-01");
    expect(trigger.textContent).toContain("10:00");
    const segments = [...trigger.firstElementChild!.children] as HTMLElement[];
    expect(segments.map((segment) => segment.textContent)).toEqual([
      "2026-08-01",
      "10:00",
    ]);
    expect(segments.every((segment) => segment.tagName === "SPAN")).toBe(true);
    expect(trigger.firstElementChild!.className).toContain("flex-col");
    expect(trigger.firstElementChild!.className).toContain("items-start");
    expect(readBound()[0].value).toBe("2026-08-01T10:00");
  });

  test("edits the canonical value through the native editor", async () => {
    const { readBound, view } = renderBounded();

    fireEvent.click(view.getByRole("button", { name: "Valid from" }));
    const native = (await view.findByLabelText(
      "Edit Valid from"
    )) as HTMLInputElement;
    expect(native.getAttribute("name")).toBeNull();
    fireEvent.input(native, { target: { value: "2026-09-01T10:30" } });

    expect(readBound()[0].value).toBe("2026-09-01T10:30");
    expect(
      view.getByRole("button", { name: "Valid from" }).textContent
    ).toContain("2026-09-01");
  });

  test("clears back to an empty canonical value", async () => {
    const { readBound, view } = renderBounded({
      defaultValue: "2026-08-10",
      type: "date",
    });

    fireEvent.click(view.getByRole("button", { name: "Valid from" }));
    const clear = await view.findByRole("button", {
      name: "Clear Valid from",
    });
    fireEvent.click(clear);

    expect(readBound()[0].value).toBe("");
    expect(view.getByRole("button", { name: "Valid from" }).textContent).toBe(
      "Not set"
    );
  });

  test("serializes exactly one named control through FormData", async () => {
    const { form, readBound, view } = renderBounded({
      defaultValue: "2026-08-01T10:00",
    });

    expect(new FormData(form).get("validFrom")).toBe("2026-08-01T10:00");

    fireEvent.click(view.getByRole("button", { name: "Valid from" }));
    const native = (await view.findByLabelText(
      "Edit Valid from"
    )) as HTMLInputElement;
    fireEvent.input(native, { target: { value: "2026-09-15T06:45" } });
    expect(new FormData(form).get("validFrom")).toBe("2026-09-15T06:45");
    expect(readBound()).toHaveLength(1);

    fireEvent.click(view.getByRole("button", { name: "Clear Valid from" }));
    expect(new FormData(form).get("validFrom")).toBe("");
    expect(readBound()).toHaveLength(1);
  });

  test("preserves the committed value while the editor reports badInput", async () => {
    const formChange = mock(() => undefined);
    const formInput = mock(() => undefined);
    const view = render(
      <form aria-label="Expiry form" onChange={formChange} onInput={formInput}>
        <TemporalInput
          defaultValue="2026-08-31T10:00"
          id="validUntil"
          label="Valid until"
          name="validUntil"
          type="datetime-local"
        />
      </form>
    );

    fireEvent.click(view.getByRole("button", { name: "Valid until" }));
    const editor = view.getByLabelText("Edit Valid until") as HTMLInputElement;
    const form = view.getByRole("form", {
      name: "Expiry form",
    }) as HTMLFormElement;
    const readHidden = () =>
      (view.container.querySelector('[name="validUntil"]') as HTMLInputElement)
        .value;

    Object.defineProperty(editor, "validity", {
      configurable: true,
      value: { valid: false, badInput: true },
    });
    fireEvent.input(editor, { target: { value: "" } });

    expect(readHidden()).toBe("2026-08-31T10:00");
    expect(new FormData(form).get("validUntil")).toBe("2026-08-31T10:00");
    expect(formChange).not.toHaveBeenCalled();
    expect(formInput).not.toHaveBeenCalled();

    Object.defineProperty(editor, "validity", {
      configurable: true,
      value: { valid: true, badInput: false },
    });
    fireEvent.input(editor, { target: { value: "2026-09-15T06:45" } });

    expect(readHidden()).toBe("2026-09-15T06:45");
    expect(new FormData(form).get("validUntil")).toBe("2026-09-15T06:45");
    expect(formInput).toHaveBeenCalled();

    fireEvent.click(view.getByRole("button", { name: "Clear Valid until" }));
    expect(readHidden()).toBe("");
    expect(new FormData(form).get("validUntil")).toBe("");
  });

  test("returns to the original default when the form resets", async () => {
    const { form, readBound, view } = renderBounded({
      defaultValue: "2026-08-01T10:00",
    });

    fireEvent.click(view.getByRole("button", { name: "Valid from" }));
    const native = (await view.findByLabelText(
      "Edit Valid from"
    )) as HTMLInputElement;
    fireEvent.input(native, { target: { value: "2026-09-15T06:45" } });
    expect(readBound()[0].value).toBe("2026-09-15T06:45");

    act(() => {
      form.reset();
    });

    expect(readBound()[0].value).toBe("2026-08-01T10:00");
    expect(
      view.getByRole("button", { name: "Valid from" }).textContent
    ).toContain("2026-08-01");
  });
});
