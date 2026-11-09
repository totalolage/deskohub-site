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

describe("administration route error boundary", () => {
  describe("in the browser", () => {
    beforeAll(registerWorkspaceComponentTestEnv);
    afterEach(cleanup);
    afterAll(unregisterWorkspaceComponentTestEnv);

    test("shows administration copy and retries by re-fetching the segment", async () => {
      const { m } = await import("@/features/administration/i18n");
      const { default: AdministrationErrorPage } = await import("./error");
      const { RouteLocaleProvider } = await import(
        "@/features/i18n/route-locale"
      );
      const reset = mock(() => {});
      const retry = mock(() => {});

      const view = render(
        <RouteLocaleProvider locale="cs-CZ">
          <AdministrationErrorPage
            error={routeError}
            reset={reset}
            retry={retry}
          />
        </RouteLocaleProvider>
      );
      view.getByRole("heading", {
        name: m.shellErrorTitle({}, { locale: "cs-CZ" }),
      });
      fireEvent.click(
        view.getByRole("button", {
          name: m.shellErrorRetry({}, { locale: "cs-CZ" }),
        })
      );

      expect(retry).toHaveBeenCalledTimes(1);
      expect(reset).not.toHaveBeenCalled();
    });
  });
});
