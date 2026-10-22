import { Schema } from "effect";
import {
  type CampaignBodyIssue,
  campaignBodyIssues,
  campaignBodyStructureIssues,
} from "./campaign-body-rules";

/**
 * Version of the stored body format. Bump it, and migrate stored bodies, when
 * a node or attribute is renamed or removed.
 */
export const campaignBodyFormatVersion = 1;

const CampaignBodyAttributeValue = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Null,
]);

export type CampaignBodyAttributeValue = typeof CampaignBodyAttributeValue.Type;

const CampaignBodyAttributes = Schema.Record(
  Schema.String,
  CampaignBodyAttributeValue
);

const CampaignBodyMark = Schema.Struct({
  type: Schema.String,
  attrs: Schema.optional(CampaignBodyAttributes),
});

// A type alias, not an interface, so the node stays assignable to JSON types.
export type CampaignBodyNode = {
  readonly type: string;
  readonly attrs?: typeof CampaignBodyAttributes.Type | undefined;
  readonly content?: ReadonlyArray<CampaignBodyNode> | undefined;
  readonly marks?: ReadonlyArray<typeof CampaignBodyMark.Type> | undefined;
  readonly text?: string | undefined;
};

/**
 * A ProseMirror JSON node, as TipTap stores it. TipTap leaves unset optional
 * fields as `undefined`, which JSON drops.
 */
export const CampaignBodyNode: Schema.Codec<CampaignBodyNode> = Schema.Struct({
  type: Schema.String,
  attrs: Schema.optional(CampaignBodyAttributes),
  content: Schema.optional(
    Schema.Array(
      Schema.suspend((): Schema.Codec<CampaignBodyNode> => CampaignBodyNode)
    )
  ),
  marks: Schema.optional(Schema.Array(CampaignBodyMark)),
  text: Schema.optional(Schema.String),
});

/** A versioned TipTap document whose `doc` passes `issues`. */
const versionedCampaignBody = (
  issues: (doc: CampaignBodyNode) => ReadonlyArray<CampaignBodyIssue>
) =>
  Schema.Struct({
    formatVersion: Schema.Literal(campaignBodyFormatVersion),
    doc: CampaignBodyNode.check(
      Schema.makeFilter((doc) =>
        issues(doc).map(({ path, issue }) => ({ path, issue }))
      )
    ),
  });

/**
 * One locale's campaign body: a versioned TipTap document. Decoding checks the
 * document against the campaign content set.
 */
export const CampaignBodyDocument = versionedCampaignBody(
  campaignBodyIssues
).annotate({
  identifier: "CampaignBodyDocument",
  description: "A campaign email body stored as versioned TipTap JSON.",
});

export type CampaignBodyDocument = typeof CampaignBodyDocument.Type;

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
