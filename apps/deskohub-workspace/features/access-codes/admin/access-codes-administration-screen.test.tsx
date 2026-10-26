import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/features/administration/i18n";
import { mockAdministratorAccess } from "@/features/administrators/server/administrator-access.test-utils";
import type { Locale } from "@/features/i18n";

const access = mockAdministratorAccess("access-codes-screen");
let requestLocale: Locale = "en-US";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [] }),
  headers: async () => new Headers(),
}));
mock.module("next/server", () => ({
  after: () => undefined,
  connection: () => Promise.resolve(),
}));
mock.module("@/instrumentation", () => ({
  postHogLoggerProvider: {
    forceFlush: () => Promise.resolve(),
    getLogger: () => ({ emit: () => undefined }),
  },
}));

mock.module("@/features/i18n/server/request-locale", () => ({
  getRequestLocale: () => Promise.resolve(requestLocale),
}));

mock.module("@/features/access-codes/admin/create-access-code-form", () => ({
  CreateStandaloneAccessCodeForm: () => <form aria-label="Access code" />,
}));

describe("access codes administration screen", () => {
  let readsBefore = 0;

  beforeEach(() => {
    access.set("administrator");
    readsBefore = access.reads();
    requestLocale = "en-US";
  });

  const authorizationChecks = () => access.reads() - readsBefore;

  test("renders the frame in the route locale before authorizing the administrator", async () => {
    requestLocale = "cs-CZ";
    const { AccessCodesAdministrationScreen } = await import(
      "./access-codes-administration-screen"
    );

    const screen = await AccessCodesAdministrationScreen();

    expect(authorizationChecks()).toBe(0);
    const markup = renderToStaticMarkup(screen);
    expect(markup).toContain(m.accessCodesPageTitle({}, { locale: "cs-CZ" }));
    expect(markup).toContain(m.accessCodesFormLoading({}, { locale: "cs-CZ" }));
  });

  test("renders no access-code form for an account without the administrator grant", async () => {
    access.set("not-administrator");
    const { AuthorizedAccessCodeCard } = await import(
      "./access-codes-administration-screen"
    );

    await expect(AuthorizedAccessCodeCard()).rejects.toHaveProperty(
      "digest",
      "NEXT_HTTP_ERROR_FALLBACK;404"
    );
    expect(authorizationChecks()).toBe(1);
  });

  test("renders the access-code form for an authorized administrator", async () => {
    const { AuthorizedAccessCodeCard } = await import(
      "./access-codes-administration-screen"
    );

    const markup = renderToStaticMarkup(await AuthorizedAccessCodeCard());

    expect(authorizationChecks()).toBe(1);
    expect(markup).toContain('<form aria-label="Access code">');
  });
});
