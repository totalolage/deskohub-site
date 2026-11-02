import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ChangeEvent, ComponentProps } from "react";
import { renderOnLocaleRoute } from "@/features/gallery/components/gallery-render.test-utils";
import type { Input as InputComponent } from "@/shared/components/ui/input";

type InputProps = ComponentProps<typeof InputComponent>;

/** The props of every input rendered since the last test started. */
const renderedInputs: InputProps[] = [];

let PhoneInput: typeof import("./phone-input").PhoneInput;

beforeAll(async () => {
  const { Input } = await import("@/shared/components/ui/input");
  // Record the props, so a test can call the handlers the field received.
  mock.module("@/shared/components/ui/input", () => ({
    Input: Object.assign(
      (props: InputProps) => {
        renderedInputs.push(props);
        return Input(props);
      },
      { displayName: Input.displayName }
    ),
  }));
  ({ PhoneInput } = await import("./phone-input"));
});

beforeEach(() => {
  renderedInputs.length = 0;
});

/** Renders the field and returns its HTML and the input's props. */
const renderField = (props: ComponentProps<typeof PhoneInput>) => {
  const html = renderOnLocaleRoute(<PhoneInput {...props} />);
  const [input] = renderedInputs;
  if (!input) throw new Error("PhoneInput rendered no input");
  return { html, input };
};

const blur = (input: InputProps) => input.onBlur?.({} as never);

describe("PhoneInput", () => {
  test("renders a telephone input with the value and extra attributes", () => {
    const { html, input } = renderField({
      value: "777 123 456",
      name: "phone",
      className: "w-40",
    });

    expect(input).toMatchObject({
      type: "tel",
      value: "777 123 456",
      name: "phone",
      variant: "default",
    });
    expect(input.className?.split(" ")).toEqual(["pl-9", "w-40"]);
    expect(html).toContain("lucide-phone");
  });

  test("passes the caller's variant through", () => {
    expect(renderField({ variant: "error" }).input.variant).toBe("error");
  });

  test("shows no validity icon before the number is checked", () => {
    const { html, input } = renderField({
      value: "12",
      showValidation: true,
    });

    expect(html).not.toContain("lucide-x");
    expect(input.className?.split(" ")).not.toContain("pr-9");
  });

  test("reports each typed value", () => {
    const onChange = mock<(value: string) => void>();
    const { input } = renderField({ onChange });

    input.onChange?.({
      target: { value: "777" },
    } as ChangeEvent<HTMLInputElement>);

    expect(onChange.mock.calls).toEqual([["777"]]);
  });

  test("reports the number in the en-US route's format on blur", () => {
    const onChange = mock<(value: string) => void>();
    const { input } = renderField({ value: "777123456", onChange });

    blur(input);

    expect(onChange.mock.calls).toEqual([["+420 777 123 456"]]);
  });

  test("formats the number for the given country on blur", () => {
    const onChange = mock<(value: string) => void>();
    const { input } = renderField({
      value: "905123456",
      countryCode: "SK",
      onChange,
    });

    blur(input);

    expect(onChange.mock.calls).toEqual([["+421 905 123 456"]]);
  });

  test("leaves the number as typed on blur when formatting is off or it can't be read", () => {
    const onChange = mock<(value: string) => void>();

    blur(
      renderField({ value: "777123456", formatOnBlur: false, onChange }).input
    );
    renderedInputs.length = 0;
    blur(renderField({ value: "12", onChange }).input);
    renderedInputs.length = 0;
    blur(renderField({ value: " ", onChange }).input);

    expect(onChange).not.toHaveBeenCalled();
  });

  test("handles typing and blur without an onChange callback", () => {
    const { input } = renderField({ value: "777123456" });

    expect(() => {
      input.onChange?.({
        target: { value: "777" },
      } as ChangeEvent<HTMLInputElement>);
      blur(input);
    }).not.toThrow();
  });
});
