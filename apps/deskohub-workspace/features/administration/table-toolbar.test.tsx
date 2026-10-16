import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

describe("AdministrationTableCount", () => {
  test.each([
    ["en-US", "1,000"],
    ["cs-CZ", "1 000"],
  ] as const)("groups the digits of a %s count", async (locale, text) => {
    const { AdministrationTableCount } = await import("./table-toolbar");
    const view = render(
      <RouteLocaleProvider locale={locale}>
        <AdministrationTableCount count={1000} label="1000 rows" />
      </RouteLocaleProvider>
    );

    expect(view.getByLabelText("1000 rows").textContent).toBe(text);
  });
});
