import { createHash } from "node:crypto";

/**
 * A one-way digest of the identifiers a budget key names. Budget keys are
 * stored verbatim, so they carry this instead of account or client ids.
 * `domain` separates one caller's keys from another's; a digest of the same
 * domain and parts never changes, so stored spends keep counting.
 */
export const budgetKeyDigest = (
  domain: string,
  ...parts: ReadonlyArray<string>
) =>
  createHash("sha256")
    .update([domain, ...parts].join("\0"))
    .digest("base64url")
    .slice(0, 32);
