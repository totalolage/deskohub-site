import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Locale } from "@/features/i18n";

let administratorAuthorization: Promise<void> = Promise.resolve();
let authorizationChecks = 0;
let requestLocale: Locale = "en-US";

mock.module(
  "@/features/administrators/server/administrator-authorization.server",
  () => ({
    authorizeAdministratorPage: () => {
      authorizationChecks += 1;
      return administratorAuthorization;
    },
  })
);

mock.module("@/features/i18n/server/request-locale", () => ({
  getRequestLocale: () => Promise.resolve(requestLocale),
}));

mock.module("@/features/access-codes/admin/create-access-code-form", () => ({
  CreateStandaloneAccessCodeForm: () => <form aria-label="Access code" />,
}));

describe("access codes administration screen", () => {
  beforeEach(() => {
    administratorAuthorization = Promise.resolve();
    authorizationChecks = 0;
    requestLocale = "en-US";
  });

  test("renders the frame in the route locale before authorizing the administrator", async () => {
    requestLocale = "cs-CZ";
    const { AccessCodesAdministrationScreen } = await import(
      "./access-codes-administration-screen"
    );

    const screen = await AccessCodesAdministrationScreen();

    expect(authorizationChecks).toBe(0);
    const markup = renderToStaticMarkup(screen);
    expect(markup).toContain("Vytvoření přístupového kódu");
    expect(markup).toContain("Načítání formuláře přístupového kódu");
  });

  test("renders no access-code form when administrator authorization fails", async () => {
    const authorizationFailure = new Error("administrator required");
    administratorAuthorization = Promise.reject(authorizationFailure);
    const { AuthorizedAccessCodeCard } = await import(
      "./access-codes-administration-screen"
    );

    await expect(AuthorizedAccessCodeCard()).rejects.toBe(authorizationFailure);
    expect(authorizationChecks).toBe(1);
  });

  test("renders the access-code form for an authorized administrator", async () => {
    const { AuthorizedAccessCodeCard } = await import(
      "./access-codes-administration-screen"
    );

    const markup = renderToStaticMarkup(await AuthorizedAccessCodeCard());

    expect(authorizationChecks).toBe(1);
    expect(markup).toContain('<form aria-label="Access code">');
  });
});
