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
 * server decides what the ledger keeps; nothing here is visible. When the
 * account withdrew after the device's choice, as from another device, the
 * device declines analytics too, unless its choice changed meanwhile.
 */
export function AccountAnalyticsConsentMirror() {
  const hydration = useWorkspaceAction(recordDeviceAnalyticsConsent, {});
  const bannerSave = useWorkspaceAction(recordDeviceAnalyticsConsent, {});

  const mirrorSavedChoice = useEffectEvent((accountId: CustomerAccountId) => {
    const mirroredChoice = visitorConsent.saveMark();
    void hydration.executeAsync({ occasion: "hydration" }).then(
      (result) => {
        const withdrawnAt = result?.data;
        // A choice saved since the request outranks the withdrawal here, and
        // another account's withdrawal never applies; the next page's mirror
        // orders them.
        if (
          !withdrawnAt ||
          visitorConsent.saveMark() !== mirroredChoice ||
          signedInAccount() !== accountId
        ) {
          return;
        }
        visitorConsent.applyAccountDecision({
          analytics: false,
          decidedAt: withdrawnAt,
          change: "account",
        });
      },
      // A failed mirror leaves the device as it is.
      () => undefined
    );
  });
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
      if (accountId !== undefined && savedConsent !== "") {
        mirrorSavedChoice(accountId);
      }
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
