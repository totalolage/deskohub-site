import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  getLocalizedDynamicPagePath,
  getLocalizedPagePath,
} from "@/features/i18n/routing";
import { unsafeReturnTargets } from "@/shared/testing/unsafe-return-targets.test-utils";

const events: string[] = [];
const withSearchParams = (searchParams: Record<string, string | string[]>) => ({
  searchParams: Promise.resolve(searchParams),
});
const arePasskeysEnabled = mock(() => Promise.resolve(false));
type SignInCardProps = {
  readonly locale: string;
  readonly passkeysEnabled: boolean;
  readonly returnTo?: string;
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
mock.module("@/features/i18n", () => ({
  getLocalizedDynamicPagePath,
  getLocalizedPagePath,
  m: {},
}));
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

    const output = await CustomerSignInPage(withSearchParams({}));

    expect(output).toMatchObject({ type: "main" });
    expect(events).toEqual(["connection", "passkeys"]);
  });

  const renderSignInCardProps = async (
    searchParams: Record<string, string | string[]>
  ) => {
    const { default: CustomerSignInPage } = await import("./page");
    signInCardProps.length = 0;
    renderToStaticMarkup(
      (await CustomerSignInPage(withSearchParams(searchParams))) as ReactElement
    );
    return signInCardProps;
  };

  test("passes only a same-origin return target to the sign-in card", async () => {
    const withReturnTo = (returnTo: string | undefined) => [
      { locale: "en-US", passkeysEnabled: false, returnTo },
    ];

    expect(
      await renderSignInCardProps({ returnTo: "/cs-CZ/admin/invoices?page=2" })
    ).toEqual(withReturnTo("/cs-CZ/admin/invoices?page=2"));
    for (const returnTo of [
      ...unsafeReturnTargets,
      ["//evil.example/admin", "/admin"],
    ]) {
      expect(await renderSignInCardProps({ returnTo })).toEqual(
        withReturnTo(undefined)
      );
    }
    expect(await renderSignInCardProps({})).toEqual(withReturnTo(undefined));
  });

  test.each([true, false])(
    "passes the passkey flag (%p) to the sign-in card",
    async (passkeysEnabled) => {
      arePasskeysEnabled.mockImplementation(async () => passkeysEnabled);

      expect(await renderSignInCardProps({})).toEqual([
        { locale: "en-US", passkeysEnabled, returnTo: undefined },
      ]);
    }
  );
});
