import { getLocaleDefinition } from "@deskohub/i18n/locale-registry";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useSettledResultReset } from "../../customer-api/settled-result-reset";
import { type AppLocale, appLocales } from "../../i18n/app-locale";
import { useAppLocale, useChooseAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { type Choice, ChoiceList } from "../../ui/choice-list";
import { BodyText } from "../../ui/controls";
import { Notice } from "../../ui/notice";
import { ScrollScreen } from "../../ui/scroll-screen";
import {
  languageSaveFailureMessage,
  languageSaveState,
  saveLanguageAtom,
} from "./language-save";

// Each language by its own name, set in its own script's font.
const languageChoices: ReadonlyArray<Choice<AppLocale>> = appLocales.map(
  (locale) => ({
    value: locale,
    label: getLocaleDefinition(locale).nativeName,
    labelLocale: locale,
  })
);

/**
 * Language: the account's language for the app and its emails. A pick is
 * saved to the account and shown at once; the list waits while a save runs,
 * and a failed save keeps the language that was showing.
 */
export function LanguageScreen() {
  const locale = useAppLocale();
  const show = useChooseAppLocale();
  const save = useAtomSet(saveLanguageAtom);
  const state = languageSaveState(useAtomValue(saveLanguageAtom));
  useSettledResultReset(saveLanguageAtom);

  return (
    <ScrollScreen>
      <BodyText>{m.account_language_intro({}, { locale })}</BodyText>
      <ChoiceList
        label={m.account_section_language({}, { locale })}
        choices={languageChoices}
        selected={locale}
        disabled={state.status === "saving"}
        // Picking the language already shown saves it too: an account
        // without a saved language shows the device's.
        onSelect={(chosen) => save({ locale: chosen, show })}
      />
      {/* Kept mounted so assistive tech announces each change. */}
      <Notice
        tone="warning"
        message={
          state.status === "failed"
            ? languageSaveFailureMessage(state.error, locale)
            : undefined
        }
      />
    </ScrollScreen>
  );
}
