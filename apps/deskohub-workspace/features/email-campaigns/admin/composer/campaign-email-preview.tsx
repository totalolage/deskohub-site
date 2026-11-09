"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import type {
  CampaignPurpose,
  CampaignTemplateKey,
} from "../../body/campaign-content";
import type { CampaignOperationFailureCopy } from "../campaign-operation-failure";
import { CampaignInboxPreview } from "../email-preview/campaign-inbox-preview";
import { useCampaignOperation } from "../use-campaign-operation";
import {
  type CampaignComposerLocaleFields,
  hasLocaleContent,
  toCampaignPreviewInput,
} from "./campaign-composer-fields";

const previewDelayMs = 500;

const missingContentMessages = {
  "cs-CZ": m.emailCampaignsEmailPreviewMissingContentCzech,
  "en-US": m.emailCampaignsEmailPreviewMissingContentEnglish,
} as const satisfies Record<Locale, (...args: never) => string>;

const previewFailureCopy: CampaignOperationFailureCopy = {
  fallback: (locale) =>
    m.emailCampaignsEmailPreviewRenderFailed({}, { locale }),
};

/**
 * The unsaved locale content rendered through the campaign template, as a
 * recipient's inbox would show it.
 */
export function CampaignEmailPreview({
  fields,
  locale,
  locales,
  onLocaleChange,
  purpose,
  templateKey,
}: {
  readonly fields: CampaignComposerLocaleFields;
  readonly locale: Locale;
  readonly locales: readonly Locale[];
  readonly onLocaleChange: (locale: Locale) => void;
  readonly purpose: CampaignPurpose;
  readonly templateKey: CampaignTemplateKey;
}) {
  const routeLocale = useRouteLocale();
  const [html, setHtml] = useState<string>();
  const [error, setError] = useState<string>();
  const hasContent = hasLocaleContent(fields);
  // Exporting the body to Markdown walks the whole document, so only an edit
  // redoes it, not the renders the pending state causes.
  const request = useMemo(
    () => toCampaignPreviewInput({ templateKey, purpose, locale, fields }),
    [templateKey, purpose, locale, fields]
  );
  const requestKey = JSON.stringify(request);
  // Responses can arrive out of order; only the latest request's applies.
  const latestRequestKey = useRef(requestKey);
  useEffect(() => {
    latestRequestKey.current = requestKey;
  }, [requestKey]);

  const render = useCampaignOperation("previewCampaignTemplate", {
    failureCopy: previewFailureCopy,
    onSuccess: (output, input) => {
      if (JSON.stringify(input) !== latestRequestKey.current) return;
      setError(undefined);
      setHtml(output.html);
    },
    onFailure: setError,
  });
  // The hook returns a new `execute` on every render, including the renders
  // its own pending state causes; an effect event keeps those from
  // rescheduling.
  const renderLatest = useEffectEvent(() => render.execute(request));

  // biome-ignore lint/correctness/useExhaustiveDependencies: requestKey captures the request.
  useEffect(() => {
    if (!hasContent) return;
    const timer = setTimeout(renderLatest, previewDelayMs);
    return () => clearTimeout(timer);
  }, [requestKey, hasContent]);

  return (
    <CampaignInboxPreview
      error={error}
      html={hasContent ? html : undefined}
      locale={locale}
      locales={locales}
      onLocaleChange={onLocaleChange}
      placeholder={
        hasContent
          ? m.emailCampaignsEmailPreviewRendering({}, { locale: routeLocale })
          : missingContentMessages[locale]({}, { locale: routeLocale })
      }
      preheader={fields.preheader}
      subject={fields.subject}
      updating={render.isExecuting}
    />
  );
}
