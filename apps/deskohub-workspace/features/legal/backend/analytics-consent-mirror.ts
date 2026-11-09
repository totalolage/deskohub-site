import "server-only";

import { Effect, Option } from "effect";
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
  const choice = deviceChoiceOf(input.cookieHeader);
  if (Option.isNone(choice)) return false;

  const ledger = yield* AnalyticsConsentLedger;
  return yield* ledger.mirror({
    accountId: input.accountId,
    decision: decisionOf(choice.value),
    locale: noticeLocaleOf(choice.value, input.locale),
    source: input.source,
    decidedAt: choice.value.lastConsentAt,
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
  const choice = deviceChoiceOf(input.cookieHeader);
  if (Option.isNone(choice)) return false;

  const ledger = yield* AnalyticsConsentLedger;
  yield* ledger.record({
    accountId: input.accountId,
    decision: decisionOf(choice.value),
    locale: noticeLocaleOf(choice.value, input.locale),
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

  const ledger = yield* AnalyticsConsentLedger;
  return currentNoticeGrantInstant(
    yield* ledger.currentDecision(session.accountId)
  );
});

/**
 * Records the request device's choice for the signed-in account: as a
 * decision made now after a banner save, or as a mirror of the saved choice
 * when the session hydrates. A signed-out request, or one whose account is
 * being deleted, records nothing.
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
  if (!session || session.deletionRequested) return false;

  const headers = yield* currentRequestHeaders;
  const device = {
    accountId: session.accountId,
    cookieHeader: headers.get("cookie") ?? "",
    locale,
  };
  return yield* occasion === "banner_save"
    ? recordBannerAnalyticsConsent(device)
    : mirrorDeviceAnalyticsConsent({ ...device, source: "hydration_mirror" });
});
