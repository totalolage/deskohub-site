"use client";

// CONTRACT STUB: the values clone replaces this implementation; the props
// below are the stable contract.

import { m } from "@/features/administration/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";

/** A discount an email value can issue codes from. */
export type EmailEditorDiscount = {
  readonly id: string;
  /** The discount's name, as the administrator knows it. */
  readonly label: string;
};

/** The email's named value definitions, edited once for every language. */
export function EmailValuesSection(_props: {
  readonly discounts: readonly EmailEditorDiscount[];
}) {
  const locale = useRouteLocale();
  return (
    <section aria-labelledby="email-editor-values-heading">
      <h2 id="email-editor-values-heading">
        {m.emailsEditorValuesHeading({}, { locale })}
      </h2>
    </section>
  );
}
