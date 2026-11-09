"use client";

import { useEffect, useEffectEvent, useLayoutEffect } from "react";
import * as CookieConsent from "vanilla-cookieconsent";
import "vanilla-cookieconsent/dist/cookieconsent.css";
import {
  getAnalyticsAccountIdentity,
  subscribeAnalyticsAccountIdentity,
} from "@/features/account/analytics-identity";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { Locale } from "@/features/i18n";
import { resolveSilentAnalyticsGrantForDevice } from "@/features/legal/actions";
import type { ConsentCategory } from "@/shared/utils/consent-cookie";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import { createConsentConfig } from "../config/consent-config";
import {
  type GoogleConsentUpdateOptions,
  setGoogleConsentDefaults,
  updateGoogleConsentMode,
} from "../utils/google-consent-mode";
import {
  announceVisitorConsentChange,
  bindVisitorConsentRevision,
  onVisitorConsentSaved,
  visitorConsent,
} from "../visitor-consent";

type ConsentBannerProps = {
  locale: Locale;
  /**
   * The banner revision of the current privacy notice and cookie policy. A
   * choice saved under another revision counts as none.
   */
  revision: number;
};

/**
 * Runs the vanilla-cookieconsent banner and preferences modal, and applies
 * each saved consent to Google consent mode before announcing it. A device
 * without a choice under the current revision sees the banner once its
 * session is known, unless the signed-in account's current decision is a
 * grant for the current privacy notice: the device then accepts analytics
 * only, without the banner (a silent grant).
 */
export function ConsentBanner({ locale, revision }: ConsentBannerProps) {
  // Layout effects run before every passive effect, where consent is read.
  useLayoutEffect(() => bindVisitorConsentRevision(revision), [revision]);

  const silentGrant = useWorkspaceAction(
    resolveSilentAnalyticsGrantForDevice,
    {}
  );
  const askForAccountGrant = useEffectEvent(() =>
    silentGrant.executeAsync({}).then(
      (result) => result?.data ?? null,
      () => null
    )
  );

  useEffect(() => {
    setGoogleConsentDefaults();
    const stopApplyingSavedConsent = onVisitorConsentSaved(applyConsent);
    let stopPrompting: (() => void) | undefined;
    let active = true;

    // The vendor runs once per page; a page served with a new revision, as
    // after a deployment, starts it again so it saves under that revision.
    if (vendorRevision !== undefined && vendorRevision !== revision) {
      CookieConsent.reset();
    }
    vendorRevision = revision;
    vendorRuns = Promise.all([
      vendorRuns,
      CookieConsent.run({
        ...createConsentConfig(locale, revision),
        onFirstConsent: () => applyConsent({ announceToTagManager: true }),
        onConsent: () => applyConsent({ announceToTagManager: false }),
        onChange: () => applyConsent({ announceToTagManager: true }),
      }),
    ]);
    void vendorRuns.then(() => {
      if (active && vendorRendered()) {
        stopPrompting = promptForConsentChoice(askForAccountGrant);
      }
    });

    applyConsent({ announceToTagManager: false });

    // Another tab's change, or one found on focus, reaches Google consent
    // mode here too, so a withdrawal elsewhere stops this tab's tags. This
    // neither re-announces nor queues consent_update.
    const stopFollowingConsent = visitorConsent.subscribe(() => {
      const accepted = visitorConsent.acceptedCategories();
      if (appliedCategories === accepted.join(",")) return;
      applyGoogleConsent(accepted, { announceToTagManager: false });
    });

    return () => {
      active = false;
      stopPrompting?.();
      stopFollowingConsent();
      stopApplyingSavedConsent();
    };
  }, [locale, revision]);

  return null;
}

// The vendor's run is asynchronous, and a run while it already runs (a
// re-run effect) returns at once, so prompting waits for every earlier run.
let vendorRuns: Promise<unknown> = Promise.resolve();
// The revision the vendor last ran with.
let vendorRevision: number | undefined;

// The accepted set Google consent mode last received in this tab.
let appliedCategories: string | undefined;

// One cookie read feeds both the update and the record of what was sent, so
// another tab's write in between cannot desynchronize them.
function applyGoogleConsent(
  accepted: readonly ConsentCategory[],
  options: GoogleConsentUpdateOptions
) {
  updateGoogleConsentMode(accepted, options);
  appliedCategories = accepted.join(",");
}

// The tag manager's consent_update is queued, so the app event always fires
// first.
function applyConsent(options: GoogleConsentUpdateOptions) {
  applyGoogleConsent(visitorConsent.acceptedCategories(), options);
  announceVisitorConsentChange();
}

/**
 * Whether the vendor rendered its banner root, `#cc-main`. With its default
 * `hideFromBots`, it stops before rendering for crawlers and automated
 * browsers (`navigator.webdriver`), which are then never prompted.
 */
const vendorRendered = () => document.getElementById("cc-main") !== null;

// How long a device without a consent cookie waits for its session and the
// account's answer before the banner opens anyway.
const choiceWaitMs = 5000;

/**
 * Shows the banner while the device has no choice under the current
 * revision. A device holding a consent cookie from an earlier revision sees
 * it at once. A device without any consent cookie waits until its session is
 * known: for each signed-in account the session verifies, the server says
 * whether the account's grant applies (a silent grant); if it does, the
 * device accepts analytics only and the banner stays closed (or closes),
 * else it opens. A device still undecided after `choiceWaitMs`, its session
 * unknown or the answer late, sees it then; a grant arriving later still
 * applies and closes it.
 * Stops once the device holds a choice.
 */
function promptForConsentChoice(
  askForAccountGrant: () => Promise<string | null>
): () => void {
  let stopped = false;
  let shown = false;
  let askedAccount: CustomerAccountId | undefined;
  // The server's answer for an account, kept so the session can briefly
  // leave the account (a refetch) and return to it.
  let answer:
    | {
        readonly accountId: CustomerAccountId;
        readonly grantedAt: string | null;
      }
    | undefined;

  const show = () => {
    if (shown) return;
    shown = true;
    CookieConsent.show(true);
  };

  const settle = () => {
    if (stopped || visitorConsent.hasChoice()) return;
    // A cookie from an earlier revision, here at the start or saved by
    // another tab meanwhile, is asked again, never silently granted.
    if (visitorConsent.saveMark() !== "") return show();

    const identity = getAnalyticsAccountIdentity();
    if (identity.status === "pending") return;
    if (identity.status !== "authenticated") return show();

    if (answer?.accountId === identity.accountId) {
      if (answer.grantedAt === null) return show();
      if (shown) CookieConsent.hide();
      visitorConsent.applyAccountDecision({
        analytics: true,
        decidedAt: answer.grantedAt,
        change: "account",
      });
      return;
    }
    if (askedAccount === identity.accountId) return;

    const { accountId } = identity;
    askedAccount = accountId;
    void askForAccountGrant().then((grantedAt) => {
      answer = { accountId, grantedAt };
      settle();
    });
  };

  const choiceWait = setTimeout(() => {
    if (!stopped && !visitorConsent.hasChoice()) show();
  }, choiceWaitMs);
  const stopFollowingIdentity = subscribeAnalyticsAccountIdentity(settle);
  settle();
  return () => {
    stopped = true;
    clearTimeout(choiceWait);
    stopFollowingIdentity();
  };
}
