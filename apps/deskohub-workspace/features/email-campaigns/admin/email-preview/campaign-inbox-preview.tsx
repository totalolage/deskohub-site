"use client";

import { Loader2 } from "lucide-react";
import { useId } from "react";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { SegmentedControl } from "@/shared/components/ui/segmented-control";
import { campaignLocaleName } from "../sending/campaign-locale-names";

/**
 * One locale of a campaign as a recipient's inbox shows it: the sender row
 * with subject and preview text above the email rendered in its template.
 * Shows `placeholder` until there is HTML to render. `locale` is the shown
 * email's language; the chrome around it follows the admin's. The email is
 * 40rem tall unless the parent's height constrains it.
 */
export function CampaignInboxPreview({
  error,
  html,
  locale,
  locales,
  onLocaleChange,
  placeholder,
  preheader,
  subject,
  updating = false,
}: {
  readonly error?: string;
  readonly html?: string;
  readonly locale: Locale;
  readonly locales: readonly Locale[];
  readonly onLocaleChange: (locale: Locale) => void;
  readonly placeholder: string;
  readonly preheader: string;
  readonly subject: string;
  readonly updating?: boolean;
}) {
  const localeName = useId();
  const routeLocale = useRouteLocale();

  return (
    <section
      aria-label={m.emailCampaignsEmailPreviewLabel(
        {},
        { locale: routeLocale }
      )}
      className="flex h-full flex-col overflow-hidden rounded-xl border border-navy-blue/10 bg-white"
    >
      <div className="flex items-center justify-between gap-3 border-navy-blue/10 border-b px-4 py-2.5">
        <h2 className="font-semibold text-navy-blue/65 text-xs uppercase tracking-[0.1em]">
          {m.emailCampaignsEmailPreviewHeading({}, { locale: routeLocale })}
        </h2>
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1 text-navy-blue/55 text-xs"
            role="status"
          >
            {updating && (
              <>
                <Loader2 aria-hidden className="size-3.5 animate-spin" />
                {m.emailCampaignsEmailPreviewUpdating(
                  {},
                  { locale: routeLocale }
                )}
              </>
            )}
          </span>
          {locales.length > 1 && (
            <SegmentedControl
              label={m.emailCampaignsEmailPreviewLanguage(
                {},
                { locale: routeLocale }
              )}
              name={localeName}
              onValueChange={onLocaleChange}
              options={locales.map((option) => ({
                label: campaignLocaleName(option, routeLocale),
                value: option,
              }))}
              size="sm"
              value={locale}
            />
          )}
        </div>
      </div>
      <div className="flex items-start gap-3 border-navy-blue/10 border-b bg-navy-blue/[0.02] px-4 py-3">
        <div
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-navy-blue font-semibold text-sm text-white"
        >
          D
        </div>
        <div className="min-w-0">
          <p className="text-navy-blue/60 text-xs">Deskohub</p>
          <p className="truncate font-semibold text-sm">
            {subject.trim() || (
              <span className="text-navy-blue/40 italic">
                {m.emailCampaignsEmailPreviewNoSubject(
                  {},
                  { locale: routeLocale }
                )}
              </span>
            )}
          </p>
          <p className="truncate text-navy-blue/55 text-sm">
            {preheader.trim() || (
              <span className="italic">
                {m.emailCampaignsEmailPreviewNoPreheader(
                  {},
                  { locale: routeLocale }
                )}
              </span>
            )}
          </p>
        </div>
      </div>
      <p
        className="border-burned-orange/20 border-b bg-burned-orange/5 px-4 py-2 text-burned-orange-ink text-sm empty:hidden"
        role="alert"
      >
        {error}
      </p>
      {html ? (
        <iframe
          className="min-h-0 w-full flex-[1_1_40rem] bg-white"
          sandbox=""
          srcDoc={html}
          title={m.emailCampaignsEmailPreviewFrameTitle(
            { language: campaignLocaleName(locale, routeLocale) },
            { locale: routeLocale }
          )}
        />
      ) : (
        <div className="flex min-h-0 flex-[1_1_40rem] items-center justify-center px-8 text-center text-navy-blue/55 text-sm">
          {placeholder}
        </div>
      )}
    </section>
  );
}
