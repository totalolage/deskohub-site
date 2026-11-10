import type {
  CustomerAnalyticsPreference,
  SaveCustomerAnalyticsPreference,
} from "@deskohub/workspace-customer-api";
import { type Cause, Effect, Match } from "effect";
import type {
  AsyncResult,
  Atom,
  AtomRegistry,
} from "effect/unstable/reactivity";
import { CurrentAccountConsentCheck } from "../../consent/account-consent-check";
import { takeAccountDecision } from "../../consent/account-consent-sync";
import { DeviceAnalyticsConsent } from "../../consent/use-analytics-consent";
import { CustomerApi } from "../../customer-api/customer-api.service";
import { customerDataRuntime } from "../../customer-api/customer-data-runtime";
import {
  customerRead,
  customerWrite,
  refreshAfterWrite,
} from "../../customer-api/customer-request";
import {
  type CustomerRequestFailure,
  type CustomerViewError,
  viewErrorOf,
} from "../../customer-api/customer-view-error";
import type { AppLocale } from "../../i18n/app-locale";
import {
  type PreferenceSaveFeedback,
  type PreferenceSwitchState,
  preferenceSaveFeedback,
  preferenceSwitchState,
} from "./preference-switch";

/**
 * The signed-in account's analytics preference (GET
 * /account/analytics-preference), which applies on every device the account
 * signs in on.
 */
export const analyticsPreferenceAtom = customerDataRuntime.atom(
  Effect.flatMap(Effect.service(CustomerApi), (api) =>
    api.account.getAnalyticsPreference()
  ).pipe(customerRead({ accountRead: false }))
);

/**
 * Reads the account's analytics preference again on each return to the
 * foreground while the screen showing it is mounted. A decision made on
 * another device meanwhile, such as a withdrawal on the site, then shows here
 * as the account consent sync applies it to this device; the Workspace
 * already holds it, so the read doesn't wait for the sync. Returns the
 * function that stops following.
 */
export const followAnalyticsPreference = ({
  registry,
  foreground,
}: {
  readonly registry: AtomRegistry.AtomRegistry;
  /** Whether the app is in the foreground (`appForegroundAtom`). */
  readonly foreground: Atom.Atom<boolean>;
}): (() => void) => {
  // Reading the atom first starts it listening; a subscription alone doesn't.
  registry.get(foreground);
  return registry.subscribe(foreground, (active) => {
    if (active) registry.refresh(analyticsPreferenceAtom);
  });
};

/**
 * Whether a failed read is the Workspace not reading the preference: it is
 * then shown as unavailable, never as off.
 */
export const isAnalyticsPreferenceUnavailable = (error: CustomerViewError) =>
  error._tag === "Unavailable";

/** What the customer chose with the switch. */
export interface AnalyticsPreferenceChoice {
  readonly granted: boolean;
  /** The language the privacy notice is shown in. */
  readonly locale: AppLocale;
}

/**
 * Saves the account's analytics preference (PUT
 * /account/analytics-preference); turning it off also anonymises the
 * account's analytics person. The saved decision then becomes this device's
 * own choice, dated when the account made it, in either direction, as the
 * site's preference does: unless the device's choice changed meanwhile,
 * which is newer, or another account signed in.
 */
export const saveAnalyticsPreference = Effect.fn(
  "AccountAnalyticsPreference.save"
)(function* ({ granted, locale }: AnalyticsPreferenceChoice) {
  const consent = yield* DeviceAnalyticsConsent;
  const check = yield* CurrentAccountConsentCheck;
  const sent = consent.current();
  const accountId = check.account();

  const api = yield* CustomerApi;
  const saved = yield* api.account
    .saveAnalyticsPreference({
      payload: { granted, locale } satisfies SaveCustomerAnalyticsPreference,
    })
    .pipe(customerWrite);
  yield* takeAccountDecision({
    accountId,
    sent,
    decision: { analytics: saved.granted, decidedAt: saved.decidedAt },
  });
});

/**
 * Runs `saveAnalyticsPreference` and reads the preference again once the
 * save may have applied.
 */
export const saveAnalyticsPreferenceAtom = customerDataRuntime.fn(
  (choice: AnalyticsPreferenceChoice, get) =>
    saveAnalyticsPreference(choice).pipe(
      refreshAfterWrite(get, [analyticsPreferenceAtom])
    )
);

/** What the analytics switch tells the customer about the last save. */
export type AnalyticsSaveFeedback = PreferenceSaveFeedback<
  /** The save may have applied; the state read again is shown. */
  | { readonly kind: "unconfirmed" }
  | { readonly kind: "failed"; readonly error: CustomerViewError }
>;

export interface AnalyticsSwitchView extends PreferenceSwitchState {
  readonly feedback: AnalyticsSaveFeedback | undefined;
}

const failureFeedback = (
  cause: Cause.Cause<CustomerRequestFailure>
): AnalyticsSaveFeedback =>
  Match.value(viewErrorOf(cause)).pipe(
    Match.tag("Unconfirmed", () => ({ kind: "unconfirmed" }) as const),
    Match.orElse((error) => ({ kind: "failed", error }) as const)
  );

/** What the analytics switch shows (`preferenceSwitchState`). */
export const analyticsSwitchView = ({
  preference,
  save,
  requested,
}: {
  readonly preference: AsyncResult.AsyncResult<
    CustomerAnalyticsPreference,
    unknown
  >;
  readonly save: AsyncResult.AsyncResult<void, CustomerRequestFailure>;
  /** The value the customer last chose, if any. */
  readonly requested: boolean | undefined;
}): AnalyticsSwitchView => {
  const shown = preferenceSwitchState({
    preference,
    save,
    requested,
    isGranted: (current) => current.granted,
  });
  return {
    ...shown,
    feedback: preferenceSaveFeedback(
      { save, shown, requested },
      failureFeedback
    ),
  };
};
