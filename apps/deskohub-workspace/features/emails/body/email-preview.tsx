import type { EmailDocument } from "@deskohub/workspace-admin-api";
import { Effect } from "effect";
import { campaignTemplates } from "@/features/email-campaigns/body/campaign-templates";
import { campaignPlaceholderFooter } from "@/features/email-campaigns/campaign-email";
import type { Locale } from "@/features/i18n";
import { renderWorkspaceEmail } from "@/shared/backend/email/render-react-email";
import { type EmailValueSnapshots, renderEmailContent } from "./email-content";

/**
 * Renders one language of an email for an admin preview, inside its template
 * with the footer of its purpose and a placeholder preferences link, as a
 * campaign preview does.
 */
export const renderEmailPreview = Effect.fn("renderEmailPreview")(function* ({
  document,
  locale,
  values,
}: {
  readonly document: EmailDocument;
  readonly locale: Locale;
  readonly values: EmailValueSnapshots;
}) {
  const content = yield* Effect.fromResult(
    renderEmailContent({ document, locale, values })
  );
  const footer = yield* campaignPlaceholderFooter({
    purpose: document.purpose,
    operationalReason: content.operationalReason,
  });
  const { Email } = campaignTemplates[document.templateKey];
  const { html, text } = yield* renderWorkspaceEmail(
    <Email
      body={content.body}
      footer={footer}
      locale={locale}
      preview={content.preheader}
    />
  );
  return { subject: content.subject, html, text };
});
