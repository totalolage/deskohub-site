import type { ReactNode } from "react";
import type { Locale } from "@/features/i18n";
import {
  type WorkspaceCampaignFooter,
  WorkspaceCampaignFooterText,
} from "./_components/workspace-campaign-footer";
import { WorkspaceEmailLayout } from "./_components/workspace-email-layout";
import { workspaceCampaignPreviewProps } from "./_fixtures/preview-props";

export type WorkspaceCampaignEmailProps = {
  readonly locale: Locale;
  readonly preview: string;
  readonly body: ReactNode;
  readonly footer: WorkspaceCampaignFooter;
};

export function WorkspaceCampaignEmail({
  locale,
  preview,
  body,
  footer,
}: WorkspaceCampaignEmailProps) {
  return (
    <WorkspaceEmailLayout
      footer={<WorkspaceCampaignFooterText footer={footer} locale={locale} />}
      locale={locale}
      preview={preview}
    >
      {body}
    </WorkspaceEmailLayout>
  );
}

WorkspaceCampaignEmail.PreviewProps = workspaceCampaignPreviewProps;

export default WorkspaceCampaignEmail;
