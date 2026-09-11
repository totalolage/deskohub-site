import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("@/features/account/components/legal/legal-screen", () => ({
  LegalScreen: ({
    strings,
  }: {
    readonly strings: { readonly title: string };
  }) => <h2>{strings.title}</h2>,
}));

describe("PublicAccountLegal", () => {
  beforeAll(registerWorkspaceComponentTestEnv);

  afterEach(cleanup);

  afterAll(unregisterWorkspaceComponentTestEnv);

  test.each([false, true])(
    "renders only legal content when signedIn is %s",
    async (signedIn) => {
      const { PublicAccountLegal } = await import("./public-account-legal");
      const view = render(
        <PublicAccountLegal locale="en-US" signedIn={signedIn} />
      );

      expect(
        view.getByRole("heading", {
          level: 2,
          name: m.accountLegalTitle({}, { locale: "en-US" }),
        })
      ).toBeTruthy();
      expect(view.container.querySelector("main")).toBeNull();
      expect(view.container.querySelector("nav")).toBeNull();
      expect(view.queryByRole("button", { name: /sign out/i })).toBeNull();
    }
  );
});
