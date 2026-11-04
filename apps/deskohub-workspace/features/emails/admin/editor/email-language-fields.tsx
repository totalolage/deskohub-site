"use client";

import { useWatch } from "react-hook-form";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { useEmailDraftForm } from "./email-draft-form";
import { emailEditorFieldIds } from "./email-editor-field-ids";
import { EmailInlineTextField } from "./email-inline-text-field";

/**
 * The texts one language has besides the body: subject, preheader and, for
 * an operational email, why the customer receives it.
 */
export function EmailLanguageFields({
  contentLocale,
}: {
  readonly contentLocale: Locale;
}) {
  const locale = useRouteLocale();
  const { control } = useEmailDraftForm();
  const purpose = useWatch({ control, name: "purpose" });
  // A reason stored before the email became a marketing one stays editable:
  // publication still checks it, and clearing it is the author's choice.
  const storedReason = useWatch({
    control,
    name: `translations.${contentLocale}.operationalReason`,
  });
  return (
    <div className="space-y-4">
      <EmailInlineTextField
        contentLocale={contentLocale}
        fieldId={emailEditorFieldIds.translation(contentLocale, "subject")}
        label={m.emailsEditorSubjectLabel({}, { locale })}
        mode="plain"
        target={{ kind: "subject" }}
      />
      <EmailInlineTextField
        contentLocale={contentLocale}
        fieldId={emailEditorFieldIds.translation(contentLocale, "preheader")}
        label={m.emailsEditorPreheaderLabel({}, { locale })}
        mode="plain"
        target={{ kind: "preheader" }}
      />
      {(purpose === "operational" || storedReason !== undefined) && (
        <EmailInlineTextField
          contentLocale={contentLocale}
          fieldId={emailEditorFieldIds.translation(
            contentLocale,
            "operationalReason"
          )}
          label={m.emailsEditorOperationalReasonLabel({}, { locale })}
          mode="plain"
          target={{ kind: "operationalReason" }}
        />
      )}
      {purpose !== "operational" && storedReason !== undefined && (
        <p className="-mt-3 text-navy-blue/60 text-xs">
          {m.emailsEditorOperationalReasonUnusedHint({}, { locale })}
        </p>
      )}
    </div>
  );
}
