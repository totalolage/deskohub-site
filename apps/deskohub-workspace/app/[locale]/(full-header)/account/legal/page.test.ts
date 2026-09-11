import { afterEach, describe, expect, mock, test } from "bun:test";
import { createElement, type ReactElement } from "react";

type PublicAccountLegalProps = {
  readonly locale: "en-US";
  readonly signedIn: boolean;
};

const PublicAccountLegal = (props: PublicAccountLegalProps) =>
  createElement("public-account-legal", props);

const runWithRequestLocale = mock(
  (callback: (locale: "en-US") => unknown): unknown => callback("en-US")
);

mock.module("@/features/account/components/public-account-legal", () => ({
  PublicAccountLegal,
}));
mock.module("@/features/i18n/server/request-locale", () => ({
  runWithRequestLocale,
}));

const pageSource = await Bun.file(
  new URL("./page.tsx", import.meta.url)
).text();

describe("public account legal route boundary", () => {
  afterEach(() => {
    runWithRequestLocale.mockClear();
  });

  test("renders public legal content without owning authentication", () => {
    expect(pageSource).toContain(
      'import { PublicAccountLegal } from "@/features/account/components/public-account-legal";'
    );
    expect(pageSource).toContain(
      'import { runWithRequestLocale } from "@/features/i18n/server/request-locale";'
    );
    expect(pageSource).toContain(
      "export default function PublicAccountLegalPage()"
    );
    expect(pageSource).toContain(
      "<PublicAccountLegal locale={locale} signedIn={false} />"
    );

    for (const forbiddenReference of [
      "CustomerAuthentication",
      "connection()",
      "Effect",
      "Result",
      "runWorkspaceEffect",
      "loadCustomerAccountPage",
      "resolveCurrentCustomerAccount",
      "CustomerProfileService",
      "CustomerReservationHistoryService",
      "Dotypos",
      "profile",
      "history",
    ]) {
      expect(pageSource).not.toContain(forbiddenReference);
    }
  });

  test("uses the localized content-only route with anonymous navigation state", async () => {
    const { default: PublicAccountLegalPage } = await import("./page");
    const route =
      PublicAccountLegalPage() as ReactElement<PublicAccountLegalProps>;

    expect(runWithRequestLocale).toHaveBeenCalledTimes(1);
    expect(route.type).toBe(PublicAccountLegal);
    expect(route.props).toEqual({
      locale: "en-US",
      signedIn: false,
    });
  });
});
