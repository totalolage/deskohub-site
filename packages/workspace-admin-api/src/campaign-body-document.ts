import { Schema } from "effect";

/**
 * Version of the campaign body document format. Bump it, and migrate stored
 * bodies, when a node or attribute is renamed or removed.
 */
export const campaignBodyFormatVersion = 1;

const AdministrationCampaignBodyAttributeValue = Schema.Union([
  Schema.String,
  Schema.Finite,
  Schema.Boolean,
  Schema.Null,
]);
export type AdministrationCampaignBodyAttributeValue =
  typeof AdministrationCampaignBodyAttributeValue.Type;

const AdministrationCampaignBodyAttributes = Schema.Record(
  Schema.String,
  AdministrationCampaignBodyAttributeValue
);

const AdministrationCampaignBodyMark = Schema.Struct({
  type: Schema.String,
  attrs: Schema.optional(AdministrationCampaignBodyAttributes),
});

// A type alias, not an interface, so the node stays assignable to JSON types.
export type AdministrationCampaignBodyNode = {
  readonly type: string;
  readonly attrs?: typeof AdministrationCampaignBodyAttributes.Type | undefined;
  readonly content?: ReadonlyArray<AdministrationCampaignBodyNode> | undefined;
  readonly marks?:
    | ReadonlyArray<typeof AdministrationCampaignBodyMark.Type>
    | undefined;
  readonly text?: string | undefined;
};

/**
 * A ProseMirror JSON node, as TipTap stores it. TipTap leaves unset optional
 * fields as `undefined`, which JSON drops.
 */
export const AdministrationCampaignBodyNode: Schema.Codec<AdministrationCampaignBodyNode> =
  Schema.Struct({
    type: Schema.String,
    attrs: Schema.optional(AdministrationCampaignBodyAttributes),
    content: Schema.optional(
      Schema.Array(
        Schema.suspend(
          (): Schema.Codec<AdministrationCampaignBodyNode> =>
            AdministrationCampaignBodyNode
        )
      )
    ),
    marks: Schema.optional(Schema.Array(AdministrationCampaignBodyMark)),
    text: Schema.optional(Schema.String),
  }).annotate({ identifier: "AdministrationCampaignBodyNode" });

/**
 * A campaign body as the editor holds it: a versioned TipTap document. Unlike
 * Markdown it carries every node and attribute unchanged. The contract checks
 * only its shape; Workspace checks it against the campaign content set.
 */
export const AdministrationCampaignBodyDocument = Schema.Struct({
  formatVersion: Schema.Literal(campaignBodyFormatVersion),
  doc: AdministrationCampaignBodyNode,
});
export type AdministrationCampaignBodyDocument =
  typeof AdministrationCampaignBodyDocument.Type;
