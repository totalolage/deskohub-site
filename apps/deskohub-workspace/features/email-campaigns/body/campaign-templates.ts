import type { ReactElement } from "react";
import {
  WorkspaceCampaignEmail,
  type WorkspaceCampaignEmailProps,
} from "@/emails/workspace-campaign";
import type { CampaignTemplateKey } from "./campaign-content";

/** Props every campaign template accepts. */
type CampaignTemplateProps = WorkspaceCampaignEmailProps;

export type CampaignTemplate = {
  readonly key: CampaignTemplateKey;
  readonly name: string;
  readonly description: string;
  readonly Email: (props: CampaignTemplateProps) => ReactElement;
};

/** The code-defined campaign templates, keyed by `CampaignTemplateKey`. */
export const campaignTemplates = {
  workspace: {
    key: "workspace",
    name: "Deskohub Workspace",
    description:
      "The Workspace email layout: navy header, white content card, and address footer.",
    Email: WorkspaceCampaignEmail,
  },
} as const satisfies Record<CampaignTemplateKey, CampaignTemplate>;
