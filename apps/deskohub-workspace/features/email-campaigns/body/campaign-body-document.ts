import {
  type AdministrationCampaignBodyAttributeValue as CampaignBodyAttributeValue,
  AdministrationCampaignBodyNode as CampaignBodyNode,
  campaignBodyFormatVersion,
} from "@deskohub/workspace-admin-api";
import { type Option, Schema } from "effect";
import {
  type CampaignBodyIssue,
  campaignBodyIssues,
  campaignBodyStructureIssues,
  englishCampaignBodyIssueMessage,
} from "./campaign-body-rules";

/** The contract defines the node and its format version. */
export {
  type CampaignBodyAttributeValue,
  CampaignBodyNode,
  campaignBodyFormatVersion,
};

/** A versioned TipTap document whose `doc` passes `issues`. */
const versionedCampaignBody = (
  issues: (doc: CampaignBodyNode) => ReadonlyArray<CampaignBodyIssue>
) =>
  Schema.Struct({
    formatVersion: Schema.Literal(campaignBodyFormatVersion),
    doc: CampaignBodyNode.check(
      Schema.makeFilter((doc) =>
        issues(doc).map((issue) => ({
          path: issue.path,
          issue: englishCampaignBodyIssueMessage(issue),
        }))
      )
    ),
  });

/**
 * One locale's campaign body: a versioned TipTap document. Decoding checks the
 * document against the campaign content set, with images from the Cloudinary
 * account `imageCloudName`.
 */
export const campaignBodyDocument = (imageCloudName: Option.Option<string>) =>
  versionedCampaignBody((doc) =>
    campaignBodyIssues(doc, imageCloudName)
  ).annotate({
    identifier: "CampaignBodyDocument",
    description: "A campaign email body stored as versioned TipTap JSON.",
  });

export type CampaignBodyDocument = ReturnType<
  typeof campaignBodyDocument
>["Type"];

/**
 * A body still being written, as a preview renders it. Decoding checks only
 * its structure: links, buttons and images may be unfinished, which saving
 * refuses.
 */
export const UnfinishedCampaignBodyDocument = versionedCampaignBody(
  campaignBodyStructureIssues
).annotate({
  identifier: "UnfinishedCampaignBodyDocument",
  description:
    "A campaign email body still being written, as versioned TipTap JSON.",
});
