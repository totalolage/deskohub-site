import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";

type CookieOptions = {
  readonly expires?: Date;
  readonly httpOnly?: boolean;
  readonly maxAge?: number;
  readonly path?: string;
  readonly sameSite?: string;
  readonly secure?: boolean;
};

const cookieValues = new Map<string, string>();
const cookieStore = {
  get: mock((name: string) => {
    const value = cookieValues.get(name);
    return value === undefined ? undefined : { value };
  }),
  set: mock(
    (_name: string, _value: string, _options: CookieOptions) => undefined
  ),
};
const { createMarketingManagementCookies, marketingManagementCookieNames } =
  await import("./marketing-management-cookies.server");

const marketingCookies = createMarketingManagementCookies(cookieStore);

const commonCookieOptions = {
  httpOnly: true,
  path: "/",
  sameSite: "lax",
  secure: true,
} as const;

describe("marketing management cookies", () => {
  beforeEach(() => {
    cookieValues.clear();
    cookieStore.get.mockClear();
    cookieStore.set.mockClear();
  });

  test("uses the fixed host-only cookie names", () => {
    expect(marketingManagementCookieNames).toEqual({
      pending: "__Host-workspace-marketing-pending",
      session: "__Host-workspace-marketing",
    });
  });

  test("reads both values from the current request cookie store", async () => {
    cookieValues.set(marketingManagementCookieNames.pending, "pending-token");
    cookieValues.set(marketingManagementCookieNames.session, "session-token");

    await expect(
      marketingCookies.readMarketingManagementCookies()
    ).resolves.toEqual({
      pending: "pending-token",
      session: "session-token",
    });
  });

  test("sets a ten-minute pending cookie and clears any session cookie", async () => {
    await marketingCookies.setPendingMarketingManagementCookie("pending-token");

    expect(cookieStore.set).toHaveBeenNthCalledWith(
      1,
      marketingManagementCookieNames.session,
      "",
      { ...commonCookieOptions, maxAge: 0 }
    );
    expect(cookieStore.set).toHaveBeenNthCalledWith(
      2,
      marketingManagementCookieNames.pending,
      "pending-token",
      { ...commonCookieOptions, maxAge: 600 }
    );
    expect(cookieStore.set.mock.calls[1]?.[2]).not.toHaveProperty("domain");
  });

  test("sets the supplied session expiry exactly and clears any pending cookie", async () => {
    const expiresAt = new Date("2030-01-02T03:04:05.678Z");

    await marketingCookies.setMarketingManagementSessionCookie({
      token: "session-token",
      expiresAt,
    });

    expect(cookieStore.set).toHaveBeenNthCalledWith(
      1,
      marketingManagementCookieNames.pending,
      "",
      { ...commonCookieOptions, maxAge: 0 }
    );
    expect(cookieStore.set).toHaveBeenNthCalledWith(
      2,
      marketingManagementCookieNames.session,
      "session-token",
      { ...commonCookieOptions, expires: expiresAt }
    );
    expect(cookieStore.set.mock.calls[1]?.[2]).not.toHaveProperty("domain");
  });

  test("clears both cookies with matching host-only options", async () => {
    await marketingCookies.clearMarketingManagementCookies();

    expect(cookieStore.set).toHaveBeenNthCalledWith(
      1,
      marketingManagementCookieNames.pending,
      "",
      { ...commonCookieOptions, maxAge: 0 }
    );
    expect(cookieStore.set).toHaveBeenNthCalledWith(
      2,
      marketingManagementCookieNames.session,
      "",
      { ...commonCookieOptions, maxAge: 0 }
    );
  });
});
