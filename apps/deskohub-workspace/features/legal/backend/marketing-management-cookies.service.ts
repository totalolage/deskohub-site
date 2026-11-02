import "server-only";

import { Context, Data, Effect, Layer } from "effect";
import { getRequestCookies } from "@/shared/backend/utils/request-cookies";
import type { MarketingManagementCookies as MarketingManagementCookieValues } from "./marketing-preferences-authority";

export class MarketingManagementCookiesUnavailable extends Data.TaggedError(
  "MarketingManagementCookiesUnavailable"
) {}

interface IMarketingManagementCookies {
  readonly read: Effect.Effect<
    MarketingManagementCookieValues,
    MarketingManagementCookiesUnavailable
  >;
  readonly setPending: (
    rawToken: string
  ) => Effect.Effect<void, MarketingManagementCookiesUnavailable>;
  readonly setSession: (input: {
    readonly token: string;
    readonly expiresAt: Date;
  }) => Effect.Effect<void, MarketingManagementCookiesUnavailable>;
  readonly clear: Effect.Effect<void, MarketingManagementCookiesUnavailable>;
}

export const marketingManagementCookieNames = {
  pending: "__Host-workspace-marketing-pending",
  session: "__Host-workspace-marketing",
} as const;

const commonCookieOptions = {
  httpOnly: true,
  path: "/",
  sameSite: "lax",
  secure: true,
} as const;
const cookieDeletionOptions = { ...commonCookieOptions, maxAge: 0 } as const;

/** Request cookies are acquired on each operation; only actions and routes may write. */
export class MarketingManagementCookies extends Context.Service<
  MarketingManagementCookies,
  IMarketingManagementCookies
>()("@deskohub-workspace/legal/MarketingManagementCookies") {
  static Default = Layer.succeed(this, {
    read: getRequestCookies.pipe(
      Effect.map((store) => ({
        pending: store.get(marketingManagementCookieNames.pending)?.value,
        session: store.get(marketingManagementCookieNames.session)?.value,
      })),
      Effect.mapError(() => new MarketingManagementCookiesUnavailable())
    ),
    setPending: (rawToken) =>
      writeCookies((store) => {
        store.set(
          marketingManagementCookieNames.session,
          "",
          cookieDeletionOptions
        );
        store.set(marketingManagementCookieNames.pending, rawToken, {
          ...commonCookieOptions,
          maxAge: 10 * 60,
        });
      }),
    setSession: ({ token, expiresAt }) =>
      writeCookies((store) => {
        store.set(
          marketingManagementCookieNames.pending,
          "",
          cookieDeletionOptions
        );
        store.set(marketingManagementCookieNames.session, token, {
          ...commonCookieOptions,
          expires: expiresAt,
        });
      }),
    clear: writeCookies((store) => {
      store.set(
        marketingManagementCookieNames.pending,
        "",
        cookieDeletionOptions
      );
      store.set(
        marketingManagementCookieNames.session,
        "",
        cookieDeletionOptions
      );
    }),
  });
}

function writeCookies(
  write: (store: Effect.Success<typeof getRequestCookies>) => void
) {
  return getRequestCookies.pipe(
    Effect.mapError(() => new MarketingManagementCookiesUnavailable()),
    Effect.flatMap((store) =>
      Effect.try({
        try: () => write(store),
        catch: () => new MarketingManagementCookiesUnavailable(),
      })
    )
  );
}
