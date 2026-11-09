import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { OfficeDayCountInput } from "./office-day-count-input";

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

afterEach(cleanup);

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

function Harness({ maximum }: { readonly maximum: number }) {
  const [dayCount, setDayCount] = useState(2);

  return (
    <OfficeDayCountInput
      aria-label="Number of days"
      maximum={maximum}
      onChange={setDayCount}
      value={dayCount}
    />
  );
}

// React DOM picks its change-event strategy when it loads. When it loads before
// happy-dom registers, it falls back to the legacy IE input polyfill, which
// watches the focused element through attachEvent and compares values on keyup.
// Dispatching both paths reaches the controlled input's onChange either way.
const typeIntoInput = (input: HTMLInputElement, value: string) => {
  Object.assign(input, {
    attachEvent: () => undefined,
    detachEvent: () => undefined,
  });
  fireEvent.focusIn(input);
  Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(input),
    "value"
  )?.set?.call(input, value);
  fireEvent.input(input);
  fireEvent.keyUp(input);
};

test("lets the day count be cleared and retyped before normalizing it on blur", () => {
  const view = render(<Harness maximum={14} />);
  const dayCount = view.getByRole<HTMLInputElement>("spinbutton", {
    name: "Number of days",
  });

  act(() => typeIntoInput(dayCount, ""));
  expect(dayCount.value).toBe("");

  act(() => typeIntoInput(dayCount, "5"));
  expect(dayCount.value).toBe("5");

  act(() => typeIntoInput(dayCount, ""));
  act(() => {
    fireEvent.blur(dayCount);
  });
  expect(dayCount.value).toBe("5");

  act(() => typeIntoInput(dayCount, "500"));
  act(() => {
    fireEvent.blur(dayCount);
  });
  expect(dayCount.value).toBe("14");
});
