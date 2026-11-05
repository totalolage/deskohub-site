"use client";

import { useWatch } from "react-hook-form";
import {
  type EmailDraftInlineParts,
  type EmailTranslationField,
  useEmailDraftForm,
} from "./email-draft-form";

/** Which translated text of one language a field edits. */
export type EmailTranslatedTextTarget =
  | { readonly kind: EmailTranslationField }
  | { readonly kind: "text"; readonly textKey: string };

/**
 * Reads and writes one translated text of `locale`. Text keys may contain
 * any character, so the text is set through its language's whole entry
 * rather than a dotted form path. Writing a text of a language with no
 * translation yet starts that translation.
 */
export const useEmailTranslatedText = (
  locale: string,
  target: EmailTranslatedTextTarget
): readonly [
  EmailDraftInlineParts | undefined,
  (parts: EmailDraftInlineParts) => void,
] => {
  const { control, getValues, setValue } = useEmailDraftForm();
  const translation = useWatch({ control, name: `translations.${locale}` });
  const parts =
    target.kind === "text"
      ? translation?.texts?.[target.textKey]
      : translation?.[target.kind];
  const setParts = (next: EmailDraftInlineParts) => {
    const current = getValues(`translations.${locale}`) ?? {};
    setValue(
      `translations.${locale}`,
      target.kind === "text"
        ? {
            ...current,
            texts: { ...current.texts, [target.textKey]: next },
          }
        : { ...current, [target.kind]: next },
      { shouldDirty: true }
    );
  };
  return [parts, setParts] as const;
};
