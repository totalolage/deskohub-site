import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { workspaceSiteConstants } from "@/shared/utils";

mock.module("next/cache", () => ({ cacheLife: () => undefined }));
mock.module("@/features/i18n/server/request-locale", () => ({
  getRequestLocale: () => Promise.resolve("en-US"),
}));

beforeAll(registerWorkspaceComponentTestEnv);
afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

test("includes the current Prague year in the copyright notice", async () => {
  const { PublicSiteFooter } = await import("./public-site-footer");
  const year = new Intl.DateTimeFormat("en", {
    timeZone: workspaceSiteConstants.location.timeZone,
    year: "numeric",
  }).format();
  const view = render(await PublicSiteFooter());

  expect(
    view.getByText(
      `© ${year} ${workspaceSiteConstants.brand.legalName}. All rights reserved.`
    )
  ).toBeTruthy();
});
