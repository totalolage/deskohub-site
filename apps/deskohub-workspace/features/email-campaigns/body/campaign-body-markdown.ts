import type { JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { Effect } from "effect";
import { Marked } from "marked";
import {
  type CampaignBodyDocument,
  type CampaignBodyNode,
  campaignBodyFormatVersion,
} from "./campaign-body-document";
import {
  campaignBodyExtensions,
  campaignBodySchema,
} from "./campaign-body-extensions";
import { emptyCampaignBody } from "./campaign-body-rules";
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

/** The TipTap document Markdown spells, not yet checked against any rules. */
const markdownDoc = (
  markdown: string
): Effect.Effect<CampaignBodyNode | JSONContent, InvalidCampaignBody> =>
  markdown.trim() === ""
    ? Effect.succeed(emptyCampaignBody)
    : Effect.try({
        try: () => markdownManager.parse(markdown),
        catch: InvalidCampaignBody.fromCause,
      });

/**
 * Spells a Markdown body as a versioned TipTap document, not yet checked
 * against any content rules. Besides CommonMark, a line
 * `[[button: Label](https://example.com)]` makes a button, and an image line
 * may end in `{align=center width=240}`.
 */
export const campaignBodyFromMarkdown = (markdown: string) =>
  markdownDoc(markdown).pipe(
    Effect.map((doc) => ({ formatVersion: campaignBodyFormatVersion, doc }))
  );

/** Serializes a campaign body back to the Markdown the parser accepts. */
export const campaignBodyToMarkdown = (body: CampaignBodyDocument): string =>
  markdownManager.serialize(campaignBodySchema.nodeFromJSON(body.doc).toJSON());
