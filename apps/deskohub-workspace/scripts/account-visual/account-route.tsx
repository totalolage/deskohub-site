import { useEffect } from "react";
import * as CookieConsent from "vanilla-cookieconsent";
import { AccountPage } from "@/features/account/components/account-page";
import { PublicAccountLegal } from "@/features/account/components/public-account-legal";
import type { CustomerAccountPageState } from "@/features/account/page-data.server";
import { createConsentConfig } from "@/features/cookie-consent/config/consent-config";
import { dispatchConsentUpdatedEvent } from "@/features/cookie-consent/utils/consent-event";
import { isConsentCategory } from "@/shared/utils/consent-cookie";
import { useNavigationState } from "./stubs/next-navigation";
import {
  type AccountVisualLocale,
  type AccountVisualScreen,
  isAccountVisualScreen,
} from "./types";

export type AccountVisualLocation = {
  readonly pathname: string;
  readonly search: string;
};

type AccountVisualPath =
  | { readonly kind: "public-legal"; readonly locale: string }
  | { readonly kind: "private-account"; readonly locale: string }
  | null;

const parseAccountVisualPath = (pathname: string): AccountVisualPath => {
  const match = /^\/([^/]+)\/account(?:\/(legal))?\/?$/.exec(pathname);
  if (!match) return null;

  return {
    kind: match[2] === "legal" ? "public-legal" : "private-account",
    locale: match[1]!,
  };
};

export const resolveAccountVisualScreen = ({
  pathname,
  search,
}: AccountVisualLocation): AccountVisualScreen => {
  const path = parseAccountVisualPath(pathname);
  if (path?.kind === "public-legal") return "legal";

  const searchParams = new URLSearchParams(search);
  if (path?.kind === "private-account") {
    const section = searchParams.get("section");
    if (isAccountVisualScreen(section)) return section;
  }

  const screen = searchParams.get("screen");
  return isAccountVisualScreen(screen) ? screen : "profile";
};

const dispatchAcceptedConsentCategories = () => {
  const acceptedCategories = (
    CookieConsent.getUserPreferences().acceptedCategories || []
  ).filter(isConsentCategory);
  dispatchConsentUpdatedEvent(acceptedCategories);
};

const readAccountVisualLocation = (): AccountVisualLocation | null =>
  globalThis.window === undefined
    ? null
    : {
        pathname: window.location.pathname,
        search: window.location.search,
      };

export function AccountVisualRoute({
  locale,
  state,
}: {
  readonly locale: AccountVisualLocale;
  readonly state: CustomerAccountPageState;
}) {
  useNavigationState();
  useEffect(() => {
    // Fixture-only: keep the consent banner out of component-only captures.
    void CookieConsent.run({
      ...createConsentConfig(locale),
      autoShow: false,
      onFirstConsent: dispatchAcceptedConsentCategories,
      onConsent: dispatchAcceptedConsentCategories,
      onChange: dispatchAcceptedConsentCategories,
    }).then(dispatchAcceptedConsentCategories);

    return () => CookieConsent.reset();
  }, [locale]);

  const location = readAccountVisualLocation();
  const path =
    location === null ? null : parseAccountVisualPath(location.pathname);
  const isPublicLegal = path?.kind === "public-legal" && path.locale === locale;
  const route = isPublicLegal ? "public-legal" : "private-account";

  return (
    <div
      data-account-visual-route={route}
      data-account-visual-route-component={
        isPublicLegal ? "PublicAccountLegal" : "AccountPage"
      }
      key={route}
      style={{ display: "contents" }}
    >
      {isPublicLegal ? (
        <PublicAccountLegal
          locale={locale}
          signedIn={state.kind === "linked"}
        />
      ) : (
        <AccountPage locale={locale} state={state} />
      )}
    </div>
  );
}
