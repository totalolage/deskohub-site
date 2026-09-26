import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const refreshAnalyticsAccountIdentity = mock(() => Promise.resolve());

mock.module("@/features/account/analytics-identity", () => ({
  refreshAnalyticsAccountIdentity,
}));

describe("SessionRefresh", () => {
  beforeAll(registerWorkspaceComponentTestEnv);

  afterEach(() => {
    cleanup();
    refreshAnalyticsAccountIdentity.mockClear();
  });

  afterAll(unregisterWorkspaceComponentTestEnv);

  test("refreshes the authoritative analytics identity once on mount", async () => {
    const { SessionRefresh } = await import("./session-refresh");

    await act(async () => {
      render(<SessionRefresh />);
    });

    expect(refreshAnalyticsAccountIdentity).toHaveBeenCalledTimes(1);
    expect(refreshAnalyticsAccountIdentity).toHaveBeenCalledWith();
  });

  test("swallows an unavailable identity refresh", async () => {
    refreshAnalyticsAccountIdentity.mockImplementationOnce(() =>
      Promise.reject(new Error("synthetic unavailable identity"))
    );
    const { SessionRefresh } = await import("./session-refresh");

    await act(async () => {
      render(<SessionRefresh />);
      await Promise.resolve();
    });

    expect(refreshAnalyticsAccountIdentity).toHaveBeenCalledTimes(1);
    expect(refreshAnalyticsAccountIdentity).toHaveBeenCalledWith();
  });
});
