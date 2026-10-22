import { MarkdownManager } from "@tiptap/markdown";
import { Effect, Schema } from "effect";
import { Marked } from "marked";
import {
  CampaignBodyDocument,
  campaignBodyFormatVersion,
  UnfinishedCampaignBodyDocument,
} from "./campaign-body-document";
import {
  campaignBodyExtensions,
  campaignBodySchema,
} from "./campaign-body-extensions";
import { InvalidCampaignBody } from "./invalid-campaign-body";

/**
 * CommonMark plus GFM without bare-URL autolinks: the editor never links
 * typed text, so an exported `https://…` or `www.…` must import as text.
 */
const campaignMarked = new Marked({
  tokenizer: { url: () => undefined },
});

const markdownManager = new MarkdownManager({
  // The manager reads only the instance API `Marked` shares with `marked`.
  marked: campaignMarked as never,
  extensions: campaignBodyExtensions,
});

/** What the editor holds for a body nobody has written yet. */
const emptyCampaignBody = { type: "doc", content: [{ type: "paragraph" }] };

/** The TipTap document Markdown spells, not yet checked against any rules. */
const markdownDoc = (markdown: string) =>
  markdown.trim() === ""
    ? Effect.succeed(emptyCampaignBody)
    : Effect.try({
        try: () => markdownManager.parse(markdown),
        catch: InvalidCampaignBody.fromCause,
      });

const decodeCampaignBodyDocument =
  Schema.decodeUnknownEffect(CampaignBodyDocument);
const decodeUnfinishedCampaignBodyDocument = Schema.decodeUnknownEffect(
  UnfinishedCampaignBodyDocument
);

/**
 * Parses a Markdown body into a validated campaign body. Besides CommonMark,
 * a line `[[button: Label](https://example.com)]` makes a button.
 */
export const parseCampaignBodyMarkdown = Effect.fn("parseCampaignBodyMarkdown")(
  function* (markdown: string) {
    const doc = yield* markdownDoc(markdown);
    return yield* decodeCampaignBodyDocument({
      formatVersion: campaignBodyFormatVersion,
      doc,
    }).pipe(Effect.mapError(InvalidCampaignBody.fromCause));
  }
);

/**
 * Parses a Markdown body still being written: like
 * `parseCampaignBodyMarkdown`, but its links, buttons and images may be
 * unfinished.
 */
export const parseUnfinishedCampaignBodyMarkdown = Effect.fn(
  "parseUnfinishedCampaignBodyMarkdown"
)(function* (markdown: string) {
  const doc = yield* markdownDoc(markdown);
  return yield* decodeUnfinishedCampaignBodyDocument({
    formatVersion: campaignBodyFormatVersion,
    doc,
  }).pipe(Effect.mapError(InvalidCampaignBody.fromCause));
});

/** Serializes a campaign body back to the Markdown the parser accepts. */
export const campaignBodyToMarkdown = (body: CampaignBodyDocument): string =>
  markdownManager.serialize(campaignBodySchema.nodeFromJSON(body.doc).toJSON());
