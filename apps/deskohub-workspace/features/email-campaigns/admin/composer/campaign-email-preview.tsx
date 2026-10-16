"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import type {
  CampaignPurpose,
  CampaignTemplateKey,
} from "../../body/campaign-content";
import { CampaignInboxPreview } from "../email-preview/campaign-inbox-preview";
import { previewCampaignEmail } from "./actions";
import {
  type CampaignComposerLocaleFields,
  hasLocaleContent,
  toCampaignLocaleContent,
} from "./campaign-composer-fields";

const previewDelayMs = 500;

const missingContentMessages = {
  "cs-CZ": m.emailCampaignsEmailPreviewMissingContentCzech,
  "en-US": m.emailCampaignsEmailPreviewMissingContentEnglish,
} as const satisfies Record<Locale, (...args: never) => string>;

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
  const [preview, setPreview] = useState<{
    readonly html: string;
    readonly subject: string;
    readonly preheader: string;
  }>();
  const [error, setError] = useState<string>();
  const hasContent = hasLocaleContent(fields);
  const request = {
    templateKey,
    purpose,
    locale,
    content: toCampaignLocaleContent(fields, purpose),
  };
  const requestKey = JSON.stringify(request);
  // Responses can arrive out of order; only the latest request's applies.
  const latestRequestKey = useRef(requestKey);
  useEffect(() => {
    latestRequestKey.current = requestKey;
  }, [requestKey]);

  const render = useWorkspaceAction(previewCampaignEmail, {
    actionName: "previewCampaignEmail",
    onSuccess: ({ data, input }) => {
      if (JSON.stringify(input) !== latestRequestKey.current) return;
      setError(undefined);
      setPreview({
        html: data.html,
        subject: data.subject,
        preheader: input.content.preheader,
      });
    },
    onError: ({ error }) =>
      setError(
        error.serverError ??
          m.emailCampaignsEmailPreviewRenderFailed({}, { locale: routeLocale })
      ),
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
      html={hasContent ? preview?.html : undefined}
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
