import type {
  CustomerAnalyticsChoice,
  CustomerAnalyticsConsentSync,
} from "@deskohub/workspace-customer-api";
import { Effect, Match } from "effect";
import type { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { CustomerApi } from "../customer-api/customer-api.service";
import { customerDataRuntime } from "../customer-api/customer-data-runtime";
import { customerWrite } from "../customer-api/customer-request";
import type { AppLocale } from "../i18n/app-locale";
import {
  type AccountConsentCheck,
  CurrentAccountConsentCheck,
} from "./account-consent-check";
import {
  type AccountAnalyticsDecision,
  type AnalyticsConsent,
  analyticsConsentStatusOf,
  consentChoiceMark,
  type StoredConsent,
} from "./analytics-consent";
import { DeviceAnalyticsConsent } from "./use-analytics-consent";

/** One sync of this device's analytics consent with the signed-in account. */
export interface AccountConsentSyncRequest {
  /** The signed-in account the sync is for. */
  readonly accountId: string;
  /** The app's language, for a choice that holds none. */
  readonly locale: AppLocale;
}

/**
 * Syncs this device's analytics choice with the signed-in account
 * (`syncAnalyticsConsent`), then settles the account's consent check. The
 * account mirrors the choice, dated when it was made, and answers the
 * decision the device takes over it: its later withdrawal, or its grant
 * while the device has no choice. The answer applies only while the device's
 * choice and the signed-in account are the ones it was sent for. A failed
 * sync changes nothing and shows nothing; the next one retries. While the
 * stored answer is still loading nothing is sent and the check stays
 * pending: reading it triggers a sync of its own.
 */
export const syncAccountAnalyticsConsent = Effect.fn(
  "AccountAnalyticsConsent.sync"
)(function* ({ accountId, locale }: AccountConsentSyncRequest) {
  const consent = yield* DeviceAnalyticsConsent;
  const check = yield* CurrentAccountConsentCheck;
  const sent = consent.current();
  if (sent === undefined) return;

  yield* exchangeWithAccount({ accountId, locale, sent }).pipe(Effect.ignore);
  yield* Effect.sync(() => check.settle(accountId));
});

/**
 * Runs `syncAccountAnalyticsConsent` in the signed-in account's data
 * runtime. A new sync interrupts one still running, which then settles
 * nothing; the newer one sends the current choice.
 */
export const syncAccountAnalyticsConsentAtom = customerDataRuntime.fn(
  syncAccountAnalyticsConsent
);

/**
 * Keeps the device's consent in sync with the signed-in account while its
 * data registry lives: syncs at once (session restore or sign-in, which
 * also mirrors a choice made while signed out), after each choice the
 * customer makes or storage yields, and on each return to the foreground,
 * which first requires a new check so analytics holds the account until it
 * settles. Returns the function that stops following.
 */
export const followAccountConsent = ({
  registry,
  foreground,
  consent,
  check,
  request,
}: {
  readonly registry: AtomRegistry.AtomRegistry;
  /** Whether the app is in the foreground (`appForegroundAtom`). */
  readonly foreground: Atom.Atom<boolean>;
  readonly consent: AnalyticsConsent;
  readonly check: AccountConsentCheck;
  readonly request: AccountConsentSyncRequest;
}): (() => void) => {
  const sync = () => registry.set(syncAccountAnalyticsConsentAtom, request);
  const unmountSync = registry.mount(syncAccountAnalyticsConsentAtom);
  // The account's own decisions came from a sync or a preference save.
  const stopFollowingConsent = consent.subscribe((change) => {
    if (change !== "account") sync();
  });
  // Runs in the AppState event itself, so the hold starts before the SDK's
  // own foreground flush can send. Reading the atom first starts it
  // listening; a subscription alone doesn't.
  registry.get(foreground);
  const stopFollowingForeground = registry.subscribe(foreground, (active) => {
    if (!active) return;
    check.recheck();
    sync();
  });
  sync();
  return () => {
    stopFollowingForeground();
    stopFollowingConsent();
    unmountSync();
  };
};

/**
 * The device's choice as the sync sends it: none (`null`) while undecided,
 * or `undefined` when it can't be sent, a malformed record read as declined
 * without a decision time. Such a refusal never needs the account's
 * withdrawal, and can't take its grant.
 */
export const syncedChoiceOf = (
  consent: StoredConsent
): CustomerAnalyticsChoice | null | undefined => {
  if (consent.kind === "undecided") return null;
  if (consent.decidedAt === undefined) return undefined;
  return {
    analytics: analyticsConsentStatusOf(consent) === "granted",
    decidedAt: consent.decidedAt,
  };
};

/**
 * The account's decision the device takes from the sync's answer: a
 * withdrawal only over a choice that accepted analytics, a grant only where
 * there was no choice, as sent.
 */
export const accountDecisionFrom = (
  answer: CustomerAnalyticsConsentSync,
  sent: StoredConsent
): AccountAnalyticsDecision | undefined =>
  Match.value(answer).pipe(
    Match.discriminatorsExhaustive("kind")({
      unchanged: () => undefined,
      withdraw: ({ decidedAt }) =>
        analyticsConsentStatusOf(sent) === "granted"
          ? { analytics: false, decidedAt }
          : undefined,
      grant: ({ decidedAt }) =>
        sent.kind === "undecided" ? { analytics: true, decidedAt } : undefined,
    })
  );

const exchangeWithAccount = Effect.fn("AccountAnalyticsConsent.exchange")(
  function* ({
    accountId,
    locale,
    sent,
  }: AccountConsentSyncRequest & { readonly sent: StoredConsent }) {
    const choice = syncedChoiceOf(sent);
    if (choice === undefined) return;

    const api = yield* CustomerApi;
    const answer = yield* api.account
      .syncAnalyticsConsent({
        payload: {
          choice,
          locale: (sent.kind === "decided" && sent.locale) || locale,
        },
      })
      .pipe(customerWrite);
    const decision = accountDecisionFrom(answer, sent);
    if (decision === undefined) return;

    // A choice made meanwhile is newer than the answer, and another
    // account's decision never applies here; the next sync orders them.
    const consent = yield* DeviceAnalyticsConsent;
    const check = yield* CurrentAccountConsentCheck;
    if (
      consentChoiceMark(consent.current()) !== consentChoiceMark(sent) ||
      check.account() !== accountId
    ) {
      return;
    }
    yield* Effect.promise(() => consent.applyAccountDecision(decision));
  }
);
