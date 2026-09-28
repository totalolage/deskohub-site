/**
 * Account magic-link synthetic-recipient policy. Auth owns only the
 * recipient-based routing decision (see `routeMagicLinkEmail`) and the
 * template; this module holds the recognition contract for the one explicitly
 * authorized bearer-material log line and the non-secret correlation identity
 * carried by every magic-link message.
 */

/**
 * Exact E2E synthetic recipient contract: `delivered+<run-id>-<label>@resend.dev`
 * where the run-id and label are opaque lowercase alphanumeric segments. Any
 * other address, including arbitrary domains, must follow the real provider
 * transport so no bearer link is ever logged for a non-synthetic recipient.
 */
export const magicLinkSyntheticRecipientPattern =
  /^delivered\+[a-z0-9]+(?:-[a-z0-9]+)*-[a-z0-9]+@resend\.dev$/i;

export const isSyntheticE2EEmailRecipient = (email: string): boolean =>
  magicLinkSyntheticRecipientPattern.test(email);

/**
 * The fixed code of the one explicitly authorized bearer-material log line: a
 * protected Vercel Preview delivering an auth magic link to an exact synthetic
 * E2E recipient prints the rendered TEXT body (which carries the magic link)
 * as a single structured raw-`console.log` line under this code, outside the
 * Effect/OTel censorship layer. Never reached for non-synthetic recipients or
 * outside Preview.
 */
export const magicLinkPreviewE2ELogCode = "account.magic-link.preview-e2e";

/**
 * Non-secret Resend correlation identity attached to every magic-link message.
 * Through the shared provider machinery these render as the Resend tags
 * `category=account-magic-link` and `surface=workspace`; the exact-SHA E2E
 * runner may use them as one additional equality check. They never carry
 * bearer or request-specific content.
 */
export const accountMagicLinkEmailCategoryTag = "account-magic-link";
export const accountMagicLinkEmailSurface = "workspace";
