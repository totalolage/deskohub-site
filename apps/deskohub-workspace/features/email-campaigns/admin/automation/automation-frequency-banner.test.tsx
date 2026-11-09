import { afterAll, afterEach, expect, test } from "bun:test";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();
// React DOM detects the DOM when it loads, so it loads after it.
const { cleanup, render } = await import("@testing-library/react");
const { AutomationFrequencyBanner } = await import(
  "./automation-frequency-banner"
);

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

test("warns when the port says the schedule fires more than hourly", () => {
  const view = render(
    <AutomationFrequencyBanner
      frequency={{ maxFiresPerHour: 4, firesMoreThanHourly: true }}
      locale="en-US"
    />
  );

  expect(view.getAllByRole("note")).toHaveLength(1);
});

test("renders nothing when the schedule fires at most hourly", () => {
  const view = render(
    <AutomationFrequencyBanner
      frequency={{ maxFiresPerHour: 1, firesMoreThanHourly: false }}
      locale="en-US"
    />
  );

  expect(view.container.childElementCount).toBe(0);
});
