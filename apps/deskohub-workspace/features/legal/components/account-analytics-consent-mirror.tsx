"use client";

import { useEffect, useEffectEvent } from "react";
import {
  getAnalyticsAccountIdentity,
  subscribeAnalyticsAccountIdentity,
} from "@/features/account/analytics-identity";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { visitorConsent } from "@/features/cookie-consent/visitor-consent";
import { recordDeviceAnalyticsConsent } from "@/features/legal/actions";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";

const signedInAccount = (): CustomerAccountId | undefined => {
  const identity = getAnalyticsAccountIdentity();
  return identity.status === "authenticated" ? identity.accountId : undefined;
};

/**
 * Records this device's analytics consent choice on the signed-in account:
 * it mirrors the saved choice once per page for each account the session
 * verifies, and records each banner save in this tab while signed in. The
 * server decides what the ledger keeps; nothing here is visible.
 */
export function AccountAnalyticsConsentMirror() {
  const hydration = useWorkspaceAction(recordDeviceAnalyticsConsent, {});
  const bannerSave = useWorkspaceAction(recordDeviceAnalyticsConsent, {});

  const mirrorSavedChoice = useEffectEvent(() =>
    hydration.execute({ occasion: "hydration" })
  );
  const recordBannerSave = useEffectEvent(() =>
    bannerSave.execute({ occasion: "banner_save" })
  );

  useEffect(() => {
    let mirroredAccount: CustomerAccountId | undefined;
    let savedConsent = visitorConsent.saveMark();

    const followIdentity = () => {
      const accountId = signedInAccount();
      if (accountId === mirroredAccount) return;
      mirroredAccount = accountId;
      if (accountId !== undefined && savedConsent !== "") mirrorSavedChoice();
    };

    // The banner also announces the saved consent on every page load, which
    // leaves the cookie unchanged; only a save in this tab rewrites it.
    const followConsent = visitorConsent.subscribe((change) => {
      const current = visitorConsent.saveMark();
      const savedHere = change === "local" && current !== savedConsent;
      savedConsent = current;
      if (savedHere && current !== "" && signedInAccount() !== undefined) {
        recordBannerSave();
      }
    });
    const stopFollowingIdentity =
      subscribeAnalyticsAccountIdentity(followIdentity);
    followIdentity();

    return () => {
      stopFollowingIdentity();
      followConsent();
    };
  }, []);

  return null;
}
