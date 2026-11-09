"use client";

import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import {
  EmailBlockLabelText,
  EmailBlockTextSetting,
  useEmailBlock,
} from "./email-block-controls";
import { emailEditorFieldIds } from "./email-editor-field-ids";
import { withEmailSetting } from "./email-structure-blocks";

/** A button's shared destination and its label in `contentLocale`. */
export function EmailBlockButtonSettings({
  contentLocale,
  index,
}: {
  readonly contentLocale: Locale;
  readonly index: number;
}) {
  const locale = useRouteLocale();
  const [component, update] = useEmailBlock(index);
  if (!component?.id) return null;
  return (
    <div className="space-y-4">
      <EmailBlockTextSetting
        fieldId={emailEditorFieldIds.componentSetting(component.id, "href")}
        label={m.emailsEditorBlockHref({}, { locale })}
        onChange={(href) => update(withEmailSetting(component, "href", href))}
        placeholder="https://"
        type="url"
        value={component.href}
      />
      <EmailBlockLabelText
        contentLocale={contentLocale}
        label={m.emailsEditorBlockButtonLabel({}, { locale })}
        textKey={component.labelKey}
      />
    </div>
  );
}
