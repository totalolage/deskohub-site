import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const { StatusBadge } = await import("./status-badge");

beforeAll(() => registerWorkspaceComponentTestEnv());
afterEach(() => cleanup());
afterAll(() => unregisterWorkspaceComponentTestEnv());

test.each([
  ["attention", "text-burned-orange-ink"],
  ["neutral", "text-navy-blue/65"],
  ["positive", "text-aquamarine-ink"],
  ["progress", "text-sunset-yellow-ink"],
] as const)("keeps %s text in its own colour family", (tone, textClass) => {
  const view = render(<StatusBadge tone={tone}>In progress</StatusBadge>);

  expect(view.getByText("In progress").classList.contains(textClass)).toBe(
    true
  );
});
