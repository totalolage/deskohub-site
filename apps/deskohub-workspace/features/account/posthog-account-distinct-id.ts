import { PostHogDistinctId } from "@deskohub/posthog/identifiers";
import type { CustomerAccountId } from "@/features/account/customer-account";

/**
 * The PostHog distinct ID of a customer account's person: the one the
 * browser identifies a consented signed-in visitor as, and the one the
 * server links a consenting author's reservation events to.
 */
export const getPostHogAccountDistinctId = (
  accountId: CustomerAccountId
): PostHogDistinctId =>
  PostHogDistinctId.make(`workspace-account:${accountId}`);
