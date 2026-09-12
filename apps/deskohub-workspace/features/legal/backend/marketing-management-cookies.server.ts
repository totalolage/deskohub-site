import "server-only";

import type { cookies } from "next/headers";
import type { MarketingManagementCookies } from "./marketing-preferences-authority";

export const marketingManagementCookieNames = {
  pending: "__Host-workspace-marketing-pending",
  session: "__Host-workspace-marketing",
} as const;

const pendingCookieMaxAgeSeconds = 10 * 60;

const commonCookieOptions = {
  httpOnly: true,
  path: "/",
  sameSite: "lax",
  secure: true,
} as const;

const cookieDeletionOptions = {
  ...commonCookieOptions,
  maxAge: 0,
} as const;

export type MarketingManagementCookieStore = Pick<
  Awaited<ReturnType<typeof cookies>>,
  "get" | "set"
>;

export interface MarketingManagementCookieOperations {
  readonly readMarketingManagementCookies: () => Promise<MarketingManagementCookies>;
  readonly setPendingMarketingManagementCookie: (
    rawToken: string
  ) => Promise<void>;
  readonly setMarketingManagementSessionCookie: (input: {
    readonly token: string;
    readonly expiresAt: Date;
  }) => Promise<void>;
  readonly clearMarketingManagementCookies: () => Promise<void>;
}

export const createMarketingManagementCookies = (
  cookieStore: MarketingManagementCookieStore
): MarketingManagementCookieOperations => ({
  readMarketingManagementCookies: async () => ({
    pending: cookieStore.get(marketingManagementCookieNames.pending)?.value,
    session: cookieStore.get(marketingManagementCookieNames.session)?.value,
  }),

  setPendingMarketingManagementCookie: async (rawToken) => {
    cookieStore.set(
      marketingManagementCookieNames.session,
      "",
      cookieDeletionOptions
    );
    cookieStore.set(marketingManagementCookieNames.pending, rawToken, {
      ...commonCookieOptions,
      maxAge: pendingCookieMaxAgeSeconds,
    });
  },

  setMarketingManagementSessionCookie: async ({ token, expiresAt }) => {
    cookieStore.set(
      marketingManagementCookieNames.pending,
      "",
      cookieDeletionOptions
    );
    cookieStore.set(marketingManagementCookieNames.session, token, {
      ...commonCookieOptions,
      expires: expiresAt,
    });
  },

  clearMarketingManagementCookies: async () => {
    cookieStore.set(
      marketingManagementCookieNames.pending,
      "",
      cookieDeletionOptions
    );
    cookieStore.set(
      marketingManagementCookieNames.session,
      "",
      cookieDeletionOptions
    );
  },
});
