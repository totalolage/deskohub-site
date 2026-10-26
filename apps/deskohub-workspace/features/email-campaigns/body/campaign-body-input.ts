import type { AdministrationCampaignBodyDocumentType } from "@deskohub/workspace-admin-api";
import { Effect, Schema } from "effect";
import type { Locale } from "@/features/i18n";
import {
  CampaignBodyDocumentInvalid,
  CampaignBodyMarkdownInvalid,
} from "../errors";
import {
  type CampaignBodyDocument,
  campaignBodyDocument,
  campaignImageCloudName,
  UnfinishedCampaignBodyDocument,
} from "./campaign-body-document";
import {
  parseCampaignBodyMarkdown,
  parseUnfinishedCampaignBodyMarkdown,
} from "./campaign-body-markdown";
import { InvalidCampaignBody } from "./invalid-campaign-body";

/** A locale's body as the campaign port takes it. */
export type CampaignBodyInput =
  | { readonly bodyMarkdown: string }
  | { readonly bodyDocument: AdministrationCampaignBodyDocumentType };

const readBody =
  (
    parseMarkdown: typeof parseCampaignBodyMarkdown,
    document: Effect.Effect<typeof UnfinishedCampaignBodyDocument>
  ) =>
  (
    locale: Locale,
    input: CampaignBodyInput
  ): Effect.Effect<
    CampaignBodyDocument,
    CampaignBodyDocumentInvalid | CampaignBodyMarkdownInvalid
  > =>
    "bodyDocument" in input
      ? document.pipe(
          Effect.flatMap((schema) =>
            Schema.decodeUnknownEffect(schema)(input.bodyDocument)
          ),
          Effect.mapError(
            (cause) =>
              new CampaignBodyDocumentInvalid({
                locale,
                cause: InvalidCampaignBody.fromCause(cause),
              })
          )
        )
      : parseMarkdown(input.bodyMarkdown).pipe(
          Effect.mapError(
            (cause) => new CampaignBodyMarkdownInvalid({ locale, cause })
          )
        );

/**
 * Reads a locale's body, given as Markdown or as the editor's document, into
 * a body that passes the campaign content rules. A document keeps every node
 * and attribute; failures name the locale.
 */
export const readCampaignBody = readBody(
  parseCampaignBodyMarkdown,
  campaignImageCloudName.pipe(Effect.map(campaignBodyDocument))
);

/**
 * Reads a body still being written, for a preview: like `readCampaignBody`,
 * but its links, buttons and images may be unfinished.
 */
export const readUnfinishedCampaignBody = readBody(
  parseUnfinishedCampaignBodyMarkdown,
  Effect.succeed(UnfinishedCampaignBodyDocument)
);
