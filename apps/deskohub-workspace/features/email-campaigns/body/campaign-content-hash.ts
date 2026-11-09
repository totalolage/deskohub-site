import { createHash } from "node:crypto";
import { Schema } from "effect";
import { canonicalJson } from "@/shared/utils/canonical-json";
import type { CampaignContent } from "./campaign-content";

export const CampaignContentHash = Schema.String.pipe(
  Schema.brand("CampaignContentHash")
).annotate({
  identifier: "CampaignContentHash",
  description:
    "SHA-256 of everything a campaign renders; a test-send confirmation code is bound to it.",
});
export type CampaignContentHash = typeof CampaignContentHash.Type;

/**
 * Hashes the subject, preheader, and body of every locale together with the
 * template and purpose. Key order does not affect the hash.
 */
export function hashCampaignContent(
  content: CampaignContent
): CampaignContentHash {
  return CampaignContentHash.make(
    createHash("sha256")
      .update(
        canonicalJson({
          purpose: content.purpose,
          templateKey: content.templateKey,
          locales: content.locales,
        })
      )
      .digest("hex")
  );
}
