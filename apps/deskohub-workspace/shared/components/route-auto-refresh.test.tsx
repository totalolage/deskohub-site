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
import { Suspense, use, useState } from "react";
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

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
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

function setDocumentVisibility(visibilityState: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: visibilityState,
  });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

test("backs off between polls up to the interval", async () => {
  const { RouteAutoRefresh } = await import("./route-auto-refresh");
  render(<RouteAutoRefresh enabled />);

  for (const [delayMs, expectedRefreshes] of [
    [2000, 1],
    [3000, 2],
    [5000, 3],
    [8000, 4],
    [10_000, 5],
    [10_000, 6],
  ] as const) {
    act(() => jest.advanceTimersByTime(delayMs - 1));
    expect(workspaceRouterRefresh).toHaveBeenCalledTimes(expectedRefreshes - 1);
    act(() => jest.advanceTimersByTime(1));
    expect(workspaceRouterRefresh).toHaveBeenCalledTimes(expectedRefreshes);
  }
});

test("keeps polling while enabled", async () => {
  const { RouteAutoRefresh } = await import("./route-auto-refresh");
  render(<RouteAutoRefresh enabled intervalMs={1000} />);

  for (let attempt = 0; attempt < 50; attempt += 1) {
    act(() => jest.advanceTimersByTime(1000));
  }

  expect(workspaceRouterRefresh).toHaveBeenCalledTimes(50);
});

test("pauses polling while hidden and refreshes on return", async () => {
  const { RouteAutoRefresh } = await import("./route-auto-refresh");
  render(<RouteAutoRefresh enabled />);

  setDocumentVisibility("hidden");
  act(() => jest.advanceTimersByTime(60_000));
  expect(workspaceRouterRefresh).not.toHaveBeenCalled();

  setDocumentVisibility("visible");
  act(() => jest.advanceTimersByTime(0));
  expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);

  act(() => jest.advanceTimersByTime(2000));
  expect(workspaceRouterRefresh).toHaveBeenCalledTimes(2);
});

test("defers the return refresh until a slow refresh finishes", async () => {
  const { RouteAutoRefresh } = await import("./route-auto-refresh");
  let finishRefresh = () => {};
  const slowRefresh = new Promise<void>((resolve) => {
    finishRefresh = resolve;
  });
  let suspendRoute = () => {};
  function SlowRoute() {
    const [isSuspended, setSuspended] = useState(false);
    suspendRoute = () => setSuspended(true);
    if (isSuspended) use(slowRefresh);
    return null;
  }
  workspaceRouterRefresh.mockImplementationOnce(() => suspendRoute());
  render(
    <>
      <Suspense fallback={null}>
        <SlowRoute />
      </Suspense>
      <RouteAutoRefresh enabled />
    </>
  );

  act(() => jest.advanceTimersByTime(2000));
  expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);

  setDocumentVisibility("hidden");
  setDocumentVisibility("visible");
  act(() => jest.advanceTimersByTime(10_000));
  expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);

  await act(async () => {
    finishRefresh();
    await slowRefresh;
  });
  act(() => jest.advanceTimersByTime(0));
  expect(workspaceRouterRefresh).toHaveBeenCalledTimes(2);
});
