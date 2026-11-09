import { Effect } from "effect";
import type { CampaignBodyDocument } from "./campaign-body-document";
import { readCampaignContent } from "./campaign-content-codec";

/** The body saving stores for a Markdown body, as `dhw` would send it. */
export const markdownCampaignBody = (
  bodyMarkdown: string
): Promise<CampaignBodyDocument> =>
  Effect.runPromise(
    readCampaignContent({
      "cs-CZ": { subject: "", preheader: "", bodyMarkdown },
    }).pipe(Effect.map((content) => content["cs-CZ"]!.body))
  );
