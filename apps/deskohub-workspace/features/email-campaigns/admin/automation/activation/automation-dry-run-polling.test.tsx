import { afterAll, afterEach, beforeEach, expect, jest, test } from "bun:test";
import { RegistryProvider } from "@effect/atom-react";
import { act, cleanup, render } from "@testing-library/react";
import { workspaceRouterRefresh } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();
beforeEach(() => {
  jest.useFakeTimers({ now: new Date("2026-10-05T08:00:00Z") });
  workspaceRouterRefresh.mockClear();
});
afterEach(() => {
  cleanup();
  jest.useRealTimers();
});
afterAll(() => unregisterWorkspaceComponentTestEnv());

/** Lets the Effect scheduler, which dispatches on `setImmediate`, catch up. */
const settle = () =>
  act(async () => {
    for (let turn = 0; turn < 5; turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  });

const advance = async (ms: number) => {
  await settle();
  act(() => jest.advanceTimersByTime(ms));
  await settle();
};

const { AutomationDryRunPolling } = await import(
  "./automation-dry-run-polling"
);

/** How long atom-react's default registry keeps an unwatched atom alive. */
const productionIdleTTL = 400;

/** The poller in a registry of its own, so no test inherits another's atom. */
const renderPolling = () => {
  const ui = (mounted: boolean) => (
    <RegistryProvider defaultIdleTTL={productionIdleTTL}>
      {mounted && <AutomationDryRunPolling />}
    </RegistryProvider>
  );
  const view = render(ui(true));
  return { setMounted: (mounted: boolean) => view.rerender(ui(mounted)) };
};

test("refreshes the route every three seconds while mounted", async () => {
  renderPolling();

  await advance(2999);
  expect(workspaceRouterRefresh).not.toHaveBeenCalled();
  await advance(1);
  expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);
  await advance(3000);
  expect(workspaceRouterRefresh).toHaveBeenCalledTimes(2);
});

test("stops refreshing once unmounted, and starts over when mounted again", async () => {
  const polling = renderPolling();
  await advance(3000);
  expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);

  polling.setMounted(false);
  await advance(30_000);
  expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);

  polling.setMounted(true);
  await advance(2999);
  expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);
  await advance(1);
  expect(workspaceRouterRefresh).toHaveBeenCalledTimes(2);
});

test("keeps its schedule through a quick remount, without an extra refresh", async () => {
  const polling = renderPolling();
  await advance(3000);
  expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);

  polling.setMounted(false);
  await advance(100);
  polling.setMounted(true);
  await advance(0);
  expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);

  // The next tick stays at 6 s; a restarted stream would tick at 6.1 s.
  await advance(2850);
  expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);
  await advance(100);
  expect(workspaceRouterRefresh).toHaveBeenCalledTimes(2);
});
