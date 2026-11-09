"use client";

import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { EmailBlockSelectSetting, useEmailBlock } from "./email-block-controls";
import { EmailBlockLinks } from "./email-block-links";
import { emailEditorFieldIds } from "./email-editor-field-ids";
import { EmailInlineTextField } from "./email-inline-text-field";

const headingLevels = [1, 2, 3] as const;

/** A paragraph's or heading's text in `contentLocale`, its level and its link destinations. */
export function EmailBlockRichTextSettings({
  contentLocale,
  index,
}: {
  readonly contentLocale: Locale;
  readonly index: number;
}) {
  const locale = useRouteLocale();
  const [component, update] = useEmailBlock(index);
  if (!component?.id) return null;
  const componentId = component.id;
  return (
    <div className="space-y-4">
      {component._tag === "Heading" && (
        <EmailBlockSelectSetting
          fieldId={emailEditorFieldIds.componentSetting(componentId, "level")}
          label={m.emailsEditorBlockLevel({}, { locale })}
          onChange={(value) => {
            const level = headingLevels.find(
              (option) => String(option) === value
            );
            if (level) update({ ...component, level });
          }}
          options={headingLevels.map((level) => ({
            value: String(level),
            label: m.emailsEditorBlockLevelOption({ level }, { locale }),
          }))}
          placeholder={m.emailsEditorBlockLevelPlaceholder({}, { locale })}
          value={
            component.level === undefined ? undefined : String(component.level)
          }
        />
      )}
      {component.textKey && (
        <EmailInlineTextField
          contentLocale={contentLocale}
          fieldId={emailEditorFieldIds.text(contentLocale, component.textKey)}
          label={m.emailsEditorBlockText({}, { locale })}
          links={component.links}
          mode="rich"
          target={{ kind: "text", textKey: component.textKey }}
        />
      )}
      <EmailBlockLinks index={index} />
    </div>
  );
}
