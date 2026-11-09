import { isTestEmailRecipient } from "@deskohub/email/backend/test-recipients";
import { Effect } from "effect";
import type { DeploymentEnvironment } from "@/shared/deployment/deployment-stage";
import { CampaignRecipientsOutsideTestDomain } from "./errors";

export const isCampaignRecipientAllowed = (
  deploymentEnvironment: DeploymentEnvironment,
  email: string
): boolean =>
  deploymentEnvironment === "production" || isTestEmailRecipient(email);

/**
 * Fails closed outside production when any campaign email (test sends
 * included) would reach an address outside the email test domain, so a
 * preview can never mail a real person.
 */
export const ensureCampaignRecipientsAllowed = (input: {
  readonly deploymentEnvironment: DeploymentEnvironment;
  readonly emails: readonly string[];
}): Effect.Effect<void, CampaignRecipientsOutsideTestDomain> => {
  const outside = input.emails.filter(
    (email) => !isCampaignRecipientAllowed(input.deploymentEnvironment, email)
  );
  return outside.length === 0
    ? Effect.void
    : Effect.fail(
        new CampaignRecipientsOutsideTestDomain({
          recipientCount: outside.length,
        })
      );
};
