import "server-only";

import { Effect, Option } from "effect";
import { requireVerifiedIdentity } from "@/features/account/backend/customer-account-resolver.service";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { isLocale, type Locale } from "@/features/i18n";
import type {
  AnalyticsConsentDecision,
  AnalyticsConsentMirrorSource,
} from "@/features/legal/analytics-consent-decision";
import { getConsentBannerRevision } from "@/features/legal/consent-banner-revision";
import { getLegalDocumentVersion } from "@/features/legal/document-version";
import { currentRequestHeaders } from "@/shared/backend/workspace-request-context";
import {
  type ConsentCookieChoice,
  getConsentCookieValuesFromCookie,
  readConsentCookieChoice,
} from "@/shared/utils/consent-cookie";
import { AnalyticsConsentLedger } from "./analytics-consent-ledger";

/** A signed-in account's request and the device consent cookie it carries. */
export type DeviceAnalyticsConsent = {
  readonly accountId: CustomerAccountId;
  /** The request's `Cookie` header, which holds the device's consent cookie. */
  readonly cookieHeader: string;
  /**
   * The request's site locale, for a choice whose banner language is not a
   * site locale.
   */
  readonly locale: Locale;
};

/**
 * A device's own analytics choice, whatever holds it: the web's consent
 * cookie or the native app's stored consent.
 */
export type DeviceAnalyticsChoice = {
  readonly decision: AnalyticsConsentDecision;
  /** The locale of the privacy notice the choice was made under. */
  readonly locale: Locale;
  /** When the device made it; none when the device holds no valid date. */
  readonly decidedAt: Option.Option<Temporal.Instant>;
};

/**
 * The account's decision a device takes over its own choice, at the
 * instant the account made it, so the device's copy never outranks a later
 * decision.
 */
export type AccountAnalyticsDecisionForDevice = {
  readonly decision: AnalyticsConsentDecision;
  readonly decidedAt: Temporal.Instant;
};

/**
 * The device's banner choice. A cookie saved under an earlier banner
 * revision, before the current privacy notice or cookie policy, holds none:
 * the banner asks again, so it is never taken as a decision under the
 * current notice.
 */
const deviceChoiceOf = (cookieHeader: string) =>
  readConsentCookieChoice(cookieHeader, {
    revision: getConsentBannerRevision(),
  });

/** The analytics decision a device's banner choice holds. */
const decisionOf = (choice: ConsentCookieChoice): AnalyticsConsentDecision =>
  choice.acceptedCategories.includes("analytics") ? "grant" : "withdraw";

/**
 * The locale of the privacy notice the choice was made under: the banner
 * language of its last save, else the request's.
 */
const noticeLocaleOf = (choice: ConsentCookieChoice, fallback: Locale) =>
  Option.getOrElse(
    Option.filter(choice.languageCode, isLocale),
    () => fallback
  );

/** The analytics choice the request's consent cookie holds, dated at its last save. */
const cookieAnalyticsChoiceOf = (
  device: DeviceAnalyticsConsent
): Option.Option<DeviceAnalyticsChoice> =>
  Option.map(deviceChoiceOf(device.cookieHeader), (choice) => ({
    decision: decisionOf(choice),
    locale: noticeLocaleOf(choice, device.locale),
    decidedAt: choice.lastConsentAt,
  }));

/**
 * Copies the device's choice into the account's ledger, dated when the
 * device made it, unless the account made a decision at that moment or
 * later. Reports whether the ledger took the choice.
 */
const mirrorDeviceChoice = Effect.fn("AnalyticsConsent.mirrorDeviceChoice")(
  function* ({
    accountId,
    choice,
    source,
  }: {
    readonly accountId: CustomerAccountId;
    readonly choice: DeviceAnalyticsChoice;
    readonly source: AnalyticsConsentMirrorSource;
  }) {
    const ledger = yield* AnalyticsConsentLedger;
    return yield* ledger.mirror({ accountId, ...choice, source });
  }
);

/**
 * Copies the device's banner choice into the account's ledger, dated at the
 * cookie's last save, unless the account made a decision at that moment or
 * later. A device without a saved choice changes nothing. Reports whether
 * the ledger took the choice.
 */
export const mirrorDeviceAnalyticsConsent = Effect.fn(
  "AnalyticsConsent.mirrorDevice"
)(function* (
  input: DeviceAnalyticsConsent & {
    readonly source: AnalyticsConsentMirrorSource;
  }
) {
  const choice = cookieAnalyticsChoiceOf(input);
  if (Option.isNone(choice)) return false;

  return yield* mirrorDeviceChoice({
    accountId: input.accountId,
    choice: choice.value,
    source: input.source,
  });
});

/**
 * Records the choice the account just saved in the banner as its decision
 * now. A device without a saved choice changes nothing. Reports whether it
 * recorded one.
 */
export const recordBannerAnalyticsConsent = Effect.fn(
  "AnalyticsConsent.recordBannerSave"
)(function* (input: DeviceAnalyticsConsent) {
  const choice = cookieAnalyticsChoiceOf(input);
  if (Option.isNone(choice)) return false;

  const ledger = yield* AnalyticsConsentLedger;
  yield* ledger.record({
    accountId: input.accountId,
    decision: choice.value.decision,
    locale: choice.value.locale,
    source: "banner",
  });
  return true;
});

/**
 * The decision's instant when it is a grant for the privacy notice now
 * published in its locale. None for a grant for an earlier notice, a
 * withdrawal, or no decision.
 */
const currentNoticeGrantInstant = (
  decision: Option.Option<{
    readonly decision: AnalyticsConsentDecision;
    readonly documentHash: string;
    readonly locale: Locale;
    readonly decidedAt: Temporal.Instant;
  }>
) =>
  Option.map(
    Option.filter(
      decision,
      (current) =>
        current.decision === "grant" &&
        current.documentHash ===
          getLegalDocumentVersion(current.locale, "privacy-policy")
    ),
    (grant) => grant.decidedAt
  );

/**
 * The account's grant a device holding no choice at all takes without asking
 * (a silent grant), as the instant the account gave it: when the account's
 * current decision is a grant for the current privacy notice.
 */
const silentGrantInstant = Effect.fn("AnalyticsConsent.silentGrantInstant")(
  function* (accountId: CustomerAccountId) {
    const ledger = yield* AnalyticsConsentLedger;
    return currentNoticeGrantInstant(yield* ledger.currentDecision(accountId));
  }
);

/**
 * The signed-in account's grant the request's device takes without asking (a
 * silent grant), as the instant the account gave it: when the device holds
 * no consent cookie at all and the account's current decision is a grant for
 * the current privacy notice. A device holding a cookie, even one saved under
 * an earlier banner revision, is asked again instead, so a change to the
 * privacy notice or the cookie policy reaches every device that saw the old
 * one. None for a signed-out request or an account being deleted. Records
 * nothing: the grant is already the account's decision.
 */
export const resolveSilentAnalyticsGrant = Effect.fn(
  "AnalyticsConsent.resolveSilentGrant"
)(function* () {
  const authentication = yield* CustomerAuthentication;
  const session = yield* authentication.currentUser;
  if (!session || session.deletionRequested) return Option.none();

  const headers = yield* currentRequestHeaders;
  const cookieHeader = headers.get("cookie") ?? "";
  if (getConsentCookieValuesFromCookie(cookieHeader).length > 0) {
    return Option.none();
  }

  return yield* silentGrantInstant(session.accountId);
});

/**
 * The account's withdrawal the device must take: when the device's choice
 * accepts analytics and the account's current decision is a withdrawal the
 * choice didn't outrank, as the ledger's ordering rule decided when it
 * mirrored the choice. A grant is never propagated to a device that holds a
 * choice.
 */
const withdrawalToPropagate = Effect.fn(
  "AnalyticsConsent.withdrawalToPropagate"
)(function* (
  accountId: CustomerAccountId,
  choice: Option.Option<DeviceAnalyticsChoice>,
  mirrored: boolean
) {
  if (mirrored || Option.isNone(choice) || choice.value.decision !== "grant") {
    return Option.none();
  }

  const ledger = yield* AnalyticsConsentLedger;
  return Option.map(
    Option.filter(
      yield* ledger.currentDecision(accountId),
      (current) => current.decision === "withdraw"
    ),
    (withdrawal) => withdrawal.decidedAt
  );
});

/**
 * Records the request device's choice for the signed-in account: as a
 * decision made now after a banner save, or as a mirror of the saved choice
 * when the session hydrates. On hydration, returns the instant of the
 * account's withdrawal when the device still accepts analytics against it,
 * as when the account opted out on another device, so the device declines
 * too; else none. A signed-out request, or one whose account is being
 * deleted, records nothing.
 */
export const recordSignedInDeviceAnalyticsConsent = Effect.fn(
  "AnalyticsConsent.recordSignedInDevice"
)(function* ({
  occasion,
  locale,
}: {
  readonly occasion: "hydration" | "banner_save";
  readonly locale: Locale;
}) {
  const authentication = yield* CustomerAuthentication;
  const session = yield* authentication.currentUser;
  if (!session || session.deletionRequested) {
    return Option.none<Temporal.Instant>();
  }

  const headers = yield* currentRequestHeaders;
  const device = {
    accountId: session.accountId,
    cookieHeader: headers.get("cookie") ?? "",
    locale,
  };
  if (occasion === "banner_save") {
    yield* recordBannerAnalyticsConsent(device);
    return Option.none<Temporal.Instant>();
  }

  const mirrored = yield* mirrorDeviceAnalyticsConsent({
    ...device,
    source: "hydration_mirror",
  });
  return yield* withdrawalToPropagate(
    device.accountId,
    cookieAnalyticsChoiceOf(device),
    mirrored
  );
});

/**
 * Syncs the native app's own analytics choice with the signed-in account,
 * under the web's rules. A choice is mirrored into the ledger with source
 * `app_mirror`, dated when the app made it, so the most recent decision
 * wins. Returns the account's decision the app takes over its own: its
 * withdrawal when the app's choice accepts analytics and didn't outrank it,
 * as on the web's hydration; its grant for the current privacy notice when
 * the app holds no choice yet, as a web device without a consent cookie
 * takes it silently; else none. A grant is never returned to an app that
 * holds a choice. Fails as an account access failure when no one is signed
 * in or the account is being deleted, which records nothing.
 */
export const syncAppAnalyticsConsent = Effect.fn("AnalyticsConsent.syncApp")(
  function* ({
    choice,
  }: {
    readonly choice: Option.Option<DeviceAnalyticsChoice>;
  }) {
    const authentication = yield* CustomerAuthentication;
    const { accountId } = yield* authentication.currentUser.pipe(
      Effect.flatMap(requireVerifiedIdentity)
    );

    if (Option.isNone(choice)) {
      return Option.map(
        yield* silentGrantInstant(accountId),
        (decidedAt): AccountAnalyticsDecisionForDevice => ({
          decision: "grant",
          decidedAt,
        })
      );
    }

    const mirrored = yield* mirrorDeviceChoice({
      accountId,
      choice: choice.value,
      source: "app_mirror",
    });
    return Option.map(
      yield* withdrawalToPropagate(accountId, choice, mirrored),
      (decidedAt): AccountAnalyticsDecisionForDevice => ({
        decision: "withdraw",
        decidedAt,
      })
    );
  }
);
