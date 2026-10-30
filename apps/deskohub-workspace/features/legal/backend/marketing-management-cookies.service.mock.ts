import { Effect, Layer } from "effect";
import {
  MarketingManagementCookies,
  MarketingManagementCookiesUnavailable,
} from "./marketing-management-cookies.service";
import type { MarketingManagementCookies as MarketingManagementCookieValues } from "./marketing-preferences-authority";

export const makeMemoryMarketingCookies = (
  initial: MarketingManagementCookieValues = {
    pending: undefined,
    session: undefined,
  }
) => {
  const state = { ...initial, writable: true };
  const write = (value: MarketingManagementCookieValues) =>
    Effect.suspend(() =>
      state.writable
        ? Effect.sync(() => {
            Object.assign(state, value);
          })
        : Effect.fail(new MarketingManagementCookiesUnavailable())
    );
  const cookies: MarketingManagementCookies["Service"] = {
    read: Effect.sync(() => ({
      pending: state.pending,
      session: state.session,
    })),
    setPending: (pending) => write({ pending, session: undefined }),
    setSession: ({ token }) => write({ pending: undefined, session: token }),
    clear: write({ pending: undefined, session: undefined }),
  };
  return {
    state,
    cookies,
    layer: Layer.succeed(MarketingManagementCookies, cookies),
  };
};
