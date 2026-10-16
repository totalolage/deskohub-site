import { beforeEach, describe, expect, mock, test } from "bun:test";
import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

let administratorAuthorization: Promise<void> = Promise.resolve();
let authorizationChecks = 0;

mock.module(
  "@/features/administrators/server/administrator-authorization.server",
  () => ({
    authorizeAdministratorPage: () => {
      authorizationChecks += 1;
      return administratorAuthorization;
    },
  })
);

mock.module("@/features/access-codes/admin/create-access-code-form", () => ({
  CreateStandaloneAccessCodeForm: () => <form aria-label="Access code" />,
}));

describe("access codes admin route", () => {
  beforeEach(() => {
    administratorAuthorization = Promise.resolve();
    authorizationChecks = 0;
  });

  test("streams the page shell before authorizing the administrator", async () => {
    const { default: AccessCodesAdminPage } = await import("./page");

    expect(isValidElement(AccessCodesAdminPage())).toBe(true);
    expect(authorizationChecks).toBe(0);
  });

  test("renders no access-code form when administrator authorization fails", async () => {
    const authorizationFailure = new Error("administrator required");
    administratorAuthorization = Promise.reject(authorizationFailure);
    const { AuthorizedAccessCodeCard } = await import("./page");

    await expect(AuthorizedAccessCodeCard()).rejects.toBe(authorizationFailure);
    expect(authorizationChecks).toBe(1);
  });

  test("renders the access-code form for an authorized administrator", async () => {
    const { AuthorizedAccessCodeCard } = await import("./page");

    const markup = renderToStaticMarkup(await AuthorizedAccessCodeCard());

    expect(authorizationChecks).toBe(1);
    expect(markup).toContain('<form aria-label="Access code">');
  });
});
