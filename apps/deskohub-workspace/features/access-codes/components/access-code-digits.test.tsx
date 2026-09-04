import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { AccessCodeDigits } from "./access-code-digits";

describe("AccessCodeDigits", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("blocks the whole pin subtree from PostHog capture and session replay", () => {
    const view = render(<AccessCodeDigits code="038472" />);

    const output = view.container.querySelector("output");
    if (!output) throw new Error("Access code digits output missing");
    expect(output.getAttribute("aria-label")).toBe("0 3 8 4 7 2");
    expect(output.classList.contains("ph-no-capture")).toBe(true);

    const digits = Array.from(output.children);
    expect(digits.map((digit) => digit.textContent)).toEqual([
      "0",
      "3",
      "8",
      "4",
      "7",
      "2",
    ]);
    for (const digit of digits) {
      expect(digit.classList.contains("ph-no-capture")).toBe(true);
    }
  });

  test("keeps the caller layout class beside the capture guard", () => {
    const view = render(<AccessCodeDigits code="038472" className="gap-1" />);

    const output = view.container.querySelector("output");
    if (!output) throw new Error("Access code digits output missing");
    expect(output.classList.contains("gap-1")).toBe(true);
    expect(output.classList.contains("ph-no-capture")).toBe(true);
  });
});
