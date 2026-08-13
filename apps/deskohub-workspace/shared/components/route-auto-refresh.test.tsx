import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  jest,
  test,
} from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { workspaceRouterRefresh } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

beforeEach(() => {
  jest.useFakeTimers({ now: new Date("2026-08-13T10:00:00Z") });
  workspaceRouterRefresh.mockClear();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

afterAll(() => {
  unregisterWorkspaceComponentTestEnv();
});

test("retries a boundary refresh when the route still has the same deadline", async () => {
  const { RouteAutoRefresh } = await import("./route-auto-refresh");
  render(
    <RouteAutoRefresh
      enabled={false}
      intervalMs={60_000}
      refreshAt="2026-08-13T10:00:01Z"
    />
  );

  act(() => jest.advanceTimersByTime(1000));
  expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);

  act(() => jest.advanceTimersByTime(60_000));
  expect(workspaceRouterRefresh).toHaveBeenCalledTimes(2);
});
