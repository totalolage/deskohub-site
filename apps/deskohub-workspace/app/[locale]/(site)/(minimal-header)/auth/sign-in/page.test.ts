import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const events: string[] = [];
const arePasskeysEnabled = mock(() => Promise.resolve(false));
type SignInCardProps = {
  readonly locale: string;
  readonly passkeysEnabled: boolean;
};
const signInCardProps: SignInCardProps[] = [];
const SignInCard = (props: SignInCardProps) => {
  signInCardProps.push(props);
  return null;
};
const connection = mock(() => Promise.resolve());

mock.module("next/server", () => ({ connection }));
mock.module("@/features/account/server/account-feature-flag.server", () => ({
  arePasskeysEnabled,
}));
mock.module("@/features/account/components/sign-in-card", () => ({
  SignInCard,
}));
mock.module("@/features/i18n", () => ({ m: {} }));
mock.module("@/features/i18n/server/request-locale", () => ({
  runWithRequestLocale: (callback: (locale: "en-US") => unknown) =>
    callback("en-US"),
}));

describe("customer sign-in route boundary", () => {
  beforeEach(() => {
    events.length = 0;
    arePasskeysEnabled.mockReset();
    arePasskeysEnabled.mockImplementation(async () => {
      events.push("passkeys");
      return false;
    });
    connection.mockReset();
    connection.mockImplementation(async () => {
      events.push("connection");
    });
  });

  test("reads the passkey flag after establishing the request-bound page", async () => {
    const { default: CustomerSignInPage } = await import("./page");

    const output = await CustomerSignInPage();

    expect(output).toMatchObject({ type: "main" });
    expect(events).toEqual(["connection", "passkeys"]);
  });

  test.each([true, false])(
    "passes the passkey flag (%p) to the sign-in card",
    async (passkeysEnabled) => {
      arePasskeysEnabled.mockImplementation(async () => passkeysEnabled);
      const { default: CustomerSignInPage } = await import("./page");

      signInCardProps.length = 0;
      renderToStaticMarkup((await CustomerSignInPage()) as ReactElement);

      expect(signInCardProps).toEqual([{ locale: "en-US", passkeysEnabled }]);
    }
  );
});
