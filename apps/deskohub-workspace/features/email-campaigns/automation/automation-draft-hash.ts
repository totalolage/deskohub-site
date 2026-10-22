import { createHash } from "node:crypto";
import type { AutomationFlowType as AutomationFlow } from "@deskohub/workspace-admin-api";
import { Schema } from "effect";
import type { CampaignRow } from "@/db/schema";
import { canonicalJson } from "@/shared/utils/canonical-json";
import type { AudienceFilter } from "../audience-filter";
import { hashCampaignContent } from "../body/campaign-content-hash";
import { canonicalAutomationFlow } from "./automation-flow";

export const AutomationDraftHash = Schema.String.pipe(
  Schema.brand("AutomationDraftHash")
).annotate({
  identifier: "AutomationDraftHash",
  description:
    "SHA-256 of an automation's publishable copy; a dry run and a version are bound to it.",
});
export type AutomationDraftHash = typeof AutomationDraftHash.Type;

/**
 * What an activation publishes: the campaign's content, purpose and
 * template, its working-copy flow, and its audience's current filter. A
 * campaign row spreads into it.
 */
export type AutomationPublishableCopy = Pick<
  CampaignRow,
  "purpose" | "templateKey" | "content"
> & {
  readonly flow: AutomationFlow;
  readonly audienceFilter: AudienceFilter;
};

/**
 * Hashes the publishable copy with its flow in canonical form. Key order and
 * calendar value order do not affect the hash. Saved-audience conditions
 * hash by id, so editing that audience changes nothing.
 */
export function hashAutomationDraft(
  copy: AutomationPublishableCopy
): AutomationDraftHash {
  return AutomationDraftHash.make(
    createHash("sha256")
      .update(
        canonicalJson({
          content: hashCampaignContent({
            purpose: copy.purpose,
            templateKey: copy.templateKey,
            locales: copy.content,
          }),
          flow: canonicalAutomationFlow(copy.flow),
          audienceFilter: copy.audienceFilter,
        })
      )
      .digest("hex")
  );
}
