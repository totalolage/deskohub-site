import { renderEmailRichText } from "@/features/emails/body/email-rich-text";
import type { CampaignBodyDocument } from "./campaign-body-document";

/** Renders a campaign body as React Email components. */
export function CampaignBodyContent({
  body,
}: {
  readonly body: CampaignBodyDocument;
}) {
  return renderEmailRichText(body.doc);
}
