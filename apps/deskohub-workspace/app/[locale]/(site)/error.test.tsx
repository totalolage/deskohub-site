import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const routeError = Object.assign(new Error("Server Components render"), {
  digest: "route-error-digest",
});

describe("localized route error boundary", () => {
  describe("in the browser", () => {
    beforeAll(registerWorkspaceComponentTestEnv);
    afterEach(cleanup);
    afterAll(unregisterWorkspaceComponentTestEnv);

    test("retries by re-fetching the segment instead of only resetting it", async () => {
      const { m } = await import("@/features/i18n");
      const { default: ErrorPage } = await import("./error");
      const { RouteLocaleProvider } = await import(
        "@/features/i18n/route-locale"
      );
      const reset = mock(() => {});
      const retry = mock(() => {});

      const view = render(
        <RouteLocaleProvider locale="cs-CZ">
          <ErrorPage error={routeError} reset={reset} retry={retry} />
        </RouteLocaleProvider>
      );
      fireEvent.click(
        view.getByRole("button", {
          name: m.errorPageRetry({}, { locale: "cs-CZ" }),
        })
      );

      expect(retry).toHaveBeenCalledTimes(1);
      expect(reset).not.toHaveBeenCalled();
    });
  });
});
