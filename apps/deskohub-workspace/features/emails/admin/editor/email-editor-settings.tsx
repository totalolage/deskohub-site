"use client";

import { Controller } from "react-hook-form";
import { m } from "@/features/administration/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { useEmailDraftForm } from "./email-draft-form";
import {
  EmailFieldProblems,
  useEmailFieldProblems,
} from "./email-editor-context";
import { emailEditorFieldIds } from "./email-editor-field-ids";

/** The email's purpose and template, shared by every language. */
export function EmailEditorSettings() {
  const locale = useRouteLocale();
  const { control } = useEmailDraftForm();
  const purpose = useEmailFieldProblems(emailEditorFieldIds.purpose);
  const template = useEmailFieldProblems(emailEditorFieldIds.template);
  return (
    <section
      aria-labelledby="email-editor-settings-heading"
      className="rounded-xl border border-navy-blue/10 bg-white p-5"
    >
      <h2
        className="mb-4 font-semibold text-navy-blue/65 text-xs uppercase tracking-[0.1em]"
        id="email-editor-settings-heading"
      >
        {m.emailsEditorSettingsHeading({}, { locale })}
      </h2>
      <div className="grid gap-4 @xl:grid-cols-2">
        <Controller
          control={control}
          name="purpose"
          render={({ field }) => (
            <div className="space-y-1.5">
              <Label htmlFor={emailEditorFieldIds.purpose}>
                {m.emailsEditorPurposeLabel({}, { locale })}
              </Label>
              <Select
                onValueChange={(value) =>
                  field.onChange(value as typeof field.value)
                }
                value={field.value ?? ""}
              >
                <SelectTrigger
                  {...purpose.controlProps}
                  id={emailEditorFieldIds.purpose}
                  ref={field.ref}
                >
                  <SelectValue
                    placeholder={m.emailsEditorPurposePlaceholder(
                      {},
                      { locale }
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="marketing">
                    {m.emailsEditorPurposeMarketing({}, { locale })}
                  </SelectItem>
                  <SelectItem value="operational">
                    {m.emailsEditorPurposeOperational({}, { locale })}
                  </SelectItem>
                </SelectContent>
              </Select>
              <EmailFieldProblems fieldId={emailEditorFieldIds.purpose} />
            </div>
          )}
        />
        <Controller
          control={control}
          name="templateKey"
          render={({ field }) => (
            <div className="space-y-1.5">
              <Label htmlFor={emailEditorFieldIds.template}>
                {m.emailsEditorTemplateLabel({}, { locale })}
              </Label>
              <Select
                onValueChange={(value) =>
                  field.onChange(value as typeof field.value)
                }
                value={field.value ?? ""}
              >
                <SelectTrigger
                  {...template.controlProps}
                  id={emailEditorFieldIds.template}
                  ref={field.ref}
                >
                  <SelectValue
                    placeholder={m.emailsEditorTemplatePlaceholder(
                      {},
                      { locale }
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="workspace">
                    {m.emailsEditorTemplateWorkspace({}, { locale })}
                  </SelectItem>
                </SelectContent>
              </Select>
              <EmailFieldProblems fieldId={emailEditorFieldIds.template} />
            </div>
          )}
        />
      </div>
    </section>
  );
}
