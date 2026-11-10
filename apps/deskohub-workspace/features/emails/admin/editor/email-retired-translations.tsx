"use client";

import { useWatch } from "react-hook-form";
import { m } from "@/features/administration/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import { useEmailDraftForm } from "./email-draft-form";
import {
  EmailFieldProblems,
  useEmailEditor,
  useEmailFieldProblems,
} from "./email-editor-context";
import { emailEditorFieldIds } from "./email-editor-field-ids";
import {
  emailEditorLanguageName,
  retiredEmailTranslationLocales,
} from "./email-editor-problems";

/**
 * Translations in languages the Workspace no longer offers. They have no
 * tab, and publication still checks them, so each can be removed here.
 */
export function EmailRetiredTranslations() {
  const { control, getValues, setValue } = useEmailDraftForm();
  const { locales } = useEmailEditor();
  useWatch({ control, name: "translations" });
  const retired = retiredEmailTranslationLocales(getValues(), locales);
  return (
    retired.length > 0 && (
      <ul className="mb-4 space-y-2">
        {retired.map((language) => (
          <RetiredTranslation
            key={language}
            language={language}
            onRemove={() => {
              const { [language]: _removed, ...kept } =
                getValues("translations") ?? {};
              setValue("translations", kept, { shouldDirty: true });
            }}
          />
        ))}
      </ul>
    )
  );
}

function RetiredTranslation({
  language,
  onRemove,
}: {
  readonly language: string;
  readonly onRemove: () => void;
}) {
  const locale = useRouteLocale();
  const fieldId = emailEditorFieldIds.retiredTranslation(language);
  const { controlProps } = useEmailFieldProblems(fieldId);
  const name = emailEditorLanguageName(language);
  return (
    <li className="rounded-md bg-sunset-yellow/15 px-3 py-2 text-navy-blue/80 text-sm">
      <p>
        {m.emailsEditorRetiredTranslationNotice({ language: name }, { locale })}
      </p>
      <Button
        aria-describedby={controlProps["aria-describedby"]}
        aria-invalid={controlProps["aria-invalid"]}
        className="mt-2"
        id={fieldId}
        onClick={onRemove}
        size="sm"
        type="button"
        variant="secondary"
      >
        {m.emailsEditorRetiredTranslationRemove({ language: name }, { locale })}
      </Button>
      <EmailFieldProblems fieldId={fieldId} />
    </li>
  );
}
