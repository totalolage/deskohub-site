import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { workspaceSiteConstants } from "@/shared/utils";

mock.module("@/features/i18n/server/request-locale", () => ({
  getRequestLocale: () => Promise.resolve("en-US"),
}));

beforeAll(registerWorkspaceComponentTestEnv);
afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

test("renders a copyright notice without time-dependent content", async () => {
  const { PublicSiteFooter } = await import("./public-site-footer");
  const view = render(await PublicSiteFooter());

  expect(
    view.getByText(
      `© ${workspaceSiteConstants.brand.legalName}. All rights reserved.`
    )
  ).toBeTruthy();
});
