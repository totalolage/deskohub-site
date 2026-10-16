"use client";

import { useState } from "react";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { CampaignInboxPreview } from "../email-preview/campaign-inbox-preview";

/** The sent campaign's email per locale, switched with the language toggle. */
export function SentCampaignEmailPreview({
  emails,
}: {
  readonly emails: readonly {
    readonly locale: Locale;
    readonly subject: string;
    readonly preheader: string;
    readonly html: string | undefined;
  }[];
}) {
  const routeLocale = useRouteLocale();
  const [emailLocale, setEmailLocale] = useState(emails[0]?.locale);
  const email = emails.find((candidate) => candidate.locale === emailLocale);
  if (!email) return null;
  return (
    <CampaignInboxPreview
      error={
        email.html
          ? undefined
          : m.emailCampaignsSentEmailRenderFailed({}, { locale: routeLocale })
      }
      html={email.html}
      locale={email.locale}
      locales={emails.map((candidate) => candidate.locale)}
      onLocaleChange={setEmailLocale}
      placeholder={m.emailCampaignsSentEmailNoPreview(
        {},
        { locale: routeLocale }
      )}
      preheader={email.preheader}
      subject={email.subject}
    />
  );
}
