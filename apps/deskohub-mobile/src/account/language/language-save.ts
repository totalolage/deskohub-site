import { Cause, Effect, Match, Option } from "effect";
import type { AsyncResult } from "effect/unstable/reactivity";
import {
  CustomerApi,
  CustomerSessionCheck,
} from "../../customer-api/customer-api.service";
import {
  accountAtom,
  customerDataRuntime,
} from "../../customer-api/customer-data-runtime";
import {
  customerWrite,
  refreshAfterWrite,
  whenWriteMayHaveApplied,
} from "../../customer-api/customer-request";
import {
  type CustomerRequestFailure,
  CustomerViewError,
  toCustomerViewError,
} from "../../customer-api/customer-view-error";
import { sharedViewErrorMessage } from "../../customer-api/customer-view-error-message";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";

/** A language the customer picked, and how the app shows it at once. */
export interface LanguageChoice {
  readonly locale: AppLocale;
  /** Shows the saved locale (`useChooseAppLocale`). */
  readonly show: (locale: AppLocale) => void;
}

/**
 * Saves the account's language (PUT /account/locale), the one the app and
 * its emails use. Once saved, the app shows it at once and asks Better Auth
 * to read the session again, whose saved locale then takes over
 * (`active-locale.ts`). An unconfirmed save shows nothing new but reads the
 * session too, which tells whether it was applied. Either also reads the
 * account again: the profile forms read a phone in the phone region of its
 * saved language, as the Workspace does.
 */
export const saveLanguageAtom = customerDataRuntime.fn(
  ({ locale, show }: LanguageChoice, get) =>
    Effect.flatMap(Effect.service(CustomerApi), (api) =>
      api.account.updateLocale({ payload: { locale } })
    ).pipe(
      customerWrite,
      Effect.tap(() => Effect.sync(() => show(locale))),
      whenWriteMayHaveApplied(
        Effect.flatMap(
          Effect.service(CustomerSessionCheck),
          (session) => session.recheck
        )
      ),
      refreshAfterWrite(get, [accountAtom]),
      Effect.asVoid
    )
);

export type LanguageSaveState =
  | { readonly status: "idle" }
  | { readonly status: "saving" }
  | { readonly status: "failed"; readonly error: CustomerViewError };

/** What the language screen shows for the last save. */
export const languageSaveState = (
  result: AsyncResult.AsyncResult<void, CustomerRequestFailure>
): LanguageSaveState =>
  result.waiting
    ? { status: "saving" }
    : Match.value(result).pipe(
        Match.tagsExhaustive({
          Initial: () => ({ status: "idle" }) as const,
          Success: () => ({ status: "idle" }) as const,
          Failure: ({ cause }) =>
            ({
              status: "failed",
              error: Option.match(Cause.findErrorOption(cause), {
                onNone: () => CustomerViewError.Unexpected(),
                onSome: toCustomerViewError,
              }),
            }) as const,
        })
      );

/** The sentence for a failed save: the shared one, else the screen's own. */
export const languageSaveFailureMessage = (
  error: CustomerViewError,
  locale: AppLocale
): string =>
  (CustomerViewError.$is("Unexpected")(error)
    ? undefined
    : sharedViewErrorMessage(error, locale)) ??
  m.account_language_save_failed({}, { locale });
