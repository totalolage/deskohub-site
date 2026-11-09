import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import type { EmailValueKind } from "./email-value-options";

const kindLabels = {
  scalar: m.emailsEditorValuesKindScalar,
  record: m.emailsEditorValuesKindRecord,
  list: m.emailsEditorValuesKindList,
  discount: m.emailsEditorValuesKindDiscount,
} as const satisfies Record<
  EmailValueKind,
  typeof m.emailsEditorValuesKindList
>;

/** What a value yields, in the administrator's language. */
export const emailValueKindLabel = (
  kind: EmailValueKind,
  locale: Locale
): string => kindLabels[kind]({}, { locale });
