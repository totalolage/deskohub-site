import { createHash } from "node:crypto";
import type { NexiCustomerId } from "@deskohub/nexi";
import { NexiCustomerIdSchema } from "@deskohub/nexi";
import type { CustomerAccountId } from "../../customer-account";

const referencePrefix = "dh";
const referenceMaxLength = 32;

/**
 * Derives the opaque provider customer reference for an account. The value is
 * a deterministic one-way hash of the account id: it never involves Dotypos
 * identities, cannot be reversed into an account id, and always satisfies the
 * provider's 32-character bound.
 */
export const getSavedCardCustomerReference = (
  accountId: CustomerAccountId
): NexiCustomerId => {
  const digest = createHash("sha256").update(accountId).digest("hex");
  return NexiCustomerIdSchema.make(
    `${referencePrefix}${digest}`.slice(0, referenceMaxLength)
  );
};
