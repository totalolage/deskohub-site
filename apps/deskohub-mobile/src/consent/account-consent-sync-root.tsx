import { RegistryContext } from "@effect/atom-react";
import { useContext, useEffect } from "react";
import { useAppLocale } from "../i18n/locale-context";
import { appForegroundAtom } from "../platform/app-foreground";
import {
  accountConsentCheckEnabled,
  appAccountConsentCheck,
} from "./account-consent-check";
import { followAccountConsent } from "./account-consent-sync";
import { appAnalyticsConsent } from "./use-analytics-consent";

/**
 * Keeps this device's analytics consent in sync with the signed-in account
 * (`followAccountConsent`) while the account's screens are mounted. Renders
 * nothing; the web bundle leaves the sync to the site.
 */
export function AccountConsentSyncRoot({
  accountId,
}: {
  readonly accountId: string;
}) {
  const registry = useContext(RegistryContext);
  const locale = useAppLocale();
  useEffect(() => {
    if (!accountConsentCheckEnabled) return;
    return followAccountConsent({
      registry,
      foreground: appForegroundAtom,
      consent: appAnalyticsConsent(),
      check: appAccountConsentCheck,
      request: { accountId, locale },
    });
  }, [registry, accountId, locale]);
  return null;
}
