import type {
  CustomerMarketingPreferences,
  SaveCustomerMarketingPreferences,
} from "@deskohub/workspace-customer-api";
import { Cause, Effect, Match, Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { CustomerApi } from "../../customer-api/customer-api.service";
import { customerDataRuntime } from "../../customer-api/customer-data-runtime";
import {
  customerRead,
  customerWrite,
  refreshAfterWrite,
} from "../../customer-api/customer-request";
import {
  type CustomerRequestFailure,
  CustomerViewError,
  toCustomerViewError,
} from "../../customer-api/customer-view-error";
import type { AppLocale } from "../../i18n/app-locale";

/**
 * The signed-in account's marketing consent (GET
 * /account/marketing-preferences). Only a linked account has one; the
 * screen asks only then.
 */
export const marketingPreferencesAtom = customerDataRuntime.atom(
  Effect.flatMap(Effect.service(CustomerApi), (api) =>
    api.account.getMarketingPreferences()
  ).pipe(customerRead({ dotyposBacked: true }))
);

/** What the customer chose with the switch, and the state it changes. */
export interface MarketingPreferenceChoice {
  /** The `context` of the preferences the switch showed. */
  readonly context: CustomerMarketingPreferences["context"];
  readonly granted: boolean;
  /** The language the consent wording was shown in. */
  readonly locale: AppLocale;
}

/**
 * Saves the customer's choice (PUT /account/marketing-preferences). Turning
 * the switch is the customer's confirmation. The preferences are read again
 * after a save that may have applied, and after a refusal because the shown
 * state was stale, so the switch then shows the current state to review.
 */
export const saveMarketingPreferenceAtom = customerDataRuntime.fn(
  ({ context, granted, locale }: MarketingPreferenceChoice, get) =>
    Effect.flatMap(Effect.service(CustomerApi), (api) =>
      api.account.saveMarketingPreferences({
        payload: {
          context,
          granted,
          confirmed: true,
          locale,
        } satisfies SaveCustomerMarketingPreferences,
      })
    ).pipe(
      customerWrite,
      Effect.tapErrorTag("CustomerMarketingPreferencesRejected", () =>
        Effect.sync(() => get.refresh(marketingPreferencesAtom))
      ),
      refreshAfterWrite(get, [marketingPreferencesAtom])
    )
);

/** What the marketing switch tells the customer about the last save. */
export type MarketingSaveFeedback =
  | { readonly kind: "saving" }
  | { readonly kind: "saved" }
  /** The shown state was outdated; the current one is shown to review. */
  | { readonly kind: "stale" }
  /** The save may have applied; the state read again is shown. */
  | { readonly kind: "unconfirmed" }
  | { readonly kind: "failed"; readonly error: CustomerViewError };

export interface MarketingSwitchView {
  /** Whether the switch shows consent as given. */
  readonly granted: boolean;
  /** Whether the switch takes input. */
  readonly enabled: boolean;
  readonly feedback: MarketingSaveFeedback | undefined;
}

const isGranted = (status: CustomerMarketingPreferences["status"]) =>
  status === "active";

// `viewErrorOf` lives with the React view; this module stays React-free.
const saveViewError = (cause: Cause.Cause<CustomerRequestFailure>) =>
  Option.match(Cause.findErrorOption(cause), {
    onNone: () => CustomerViewError.Unexpected(),
    onSome: toCustomerViewError,
  });

const failureFeedback = (
  cause: Cause.Cause<CustomerRequestFailure>
): MarketingSaveFeedback =>
  Match.value(saveViewError(cause)).pipe(
    Match.tag("MarketingPreferencesStale", () => ({ kind: "stale" }) as const),
    Match.tag("Unconfirmed", () => ({ kind: "unconfirmed" }) as const),
    Match.orElse((error) => ({ kind: "failed", error }) as const)
  );

// What the last finished save tells the customer, if anything.
const settledFeedback = (
  save: AsyncResult.AsyncResult<void, CustomerRequestFailure>
): MarketingSaveFeedback | undefined =>
  AsyncResult.match(save, {
    onInitial: () => undefined,
    onSuccess: () => ({ kind: "saved" }),
    onFailure: ({ cause }) => failureFeedback(cause),
  });

/**
 * What the marketing switch shows: the saved state, or the customer's
 * choice while it is being saved and until the preferences read after the
 * save arrive, so the switch doesn't flip back in between. It takes no
 * input while a save or a read is in flight.
 */
export const marketingSwitchView = ({
  preferences,
  save,
  requested,
}: {
  readonly preferences: AsyncResult.AsyncResult<
    CustomerMarketingPreferences,
    unknown
  >;
  readonly save: AsyncResult.AsyncResult<void, CustomerRequestFailure>;
  /** The value the customer last chose, if any. */
  readonly requested: boolean | undefined;
}): MarketingSwitchView => {
  const saved = Option.exists(AsyncResult.value(preferences), (current) =>
    isGranted(current.status)
  );
  const saving = save.waiting;
  const awaitingSavedState = AsyncResult.isSuccess(save) && preferences.waiting;
  return {
    granted:
      (saving || awaitingSavedState) && requested !== undefined
        ? requested
        : saved,
    enabled: !saving && !preferences.waiting,
    feedback: saving ? { kind: "saving" } : settledFeedback(save),
  };
};
