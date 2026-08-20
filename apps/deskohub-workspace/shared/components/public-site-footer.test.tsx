import {
  afterAll,
  afterEach,
  beforeAll,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { workspaceSiteConstants } from "@/shared/utils";

mock.module("next/cache", () => ({ cacheLife: () => undefined }));
mock.module("@/features/i18n/server/request-locale", () => ({
  getRequestLocale: () => Promise.resolve("cs-CZ"),
}));

beforeAll(registerWorkspaceComponentTestEnv);
afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

test("formats the current Prague year with the request locale", async () => {
  const formatter = spyOn(Intl, "DateTimeFormat");
  const { PublicSiteFooter } = await import("./public-site-footer");
  const year = new Intl.DateTimeFormat("cs-CZ", {
    timeZone: workspaceSiteConstants.location.timeZone,
    year: "numeric",
  }).format();
  const view = render(await PublicSiteFooter());

  expect(
    view.getByText(
      `© ${year} ${workspaceSiteConstants.brand.legalName}. Všechna práva vyhrazena.`
    )
  ).toBeTruthy();
  expect(formatter).toHaveBeenCalledWith("cs-CZ", {
    timeZone: workspaceSiteConstants.location.timeZone,
    year: "numeric",
  });
  formatter.mockRestore();
});
