"use client";

// CONTRACT STUB: the structure clone replaces this implementation; the props
// below are the stable contract.

import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";

/**
 * The shared body structure, with each block's translated texts in
 * `contentLocale` inline under it.
 */
export function EmailStructureSection(_props: {
  readonly contentLocale: Locale;
}) {
  const locale = useRouteLocale();
  return (
    <section aria-labelledby="email-editor-structure-heading">
      <h2 id="email-editor-structure-heading">
        {m.emailsEditorStructureHeading({}, { locale })}
      </h2>
    </section>
  );
}
