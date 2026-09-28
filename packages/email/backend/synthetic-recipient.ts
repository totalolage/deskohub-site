/**
 * Shared auth magic-link identity markers. Auth routes per recipient (see
 * `routeMagicLinkEmail` in the Workspace account feature); this module only
 * gives the shared Console provider the marker and predicate it needs to
 * recognize the synthetic E2E delivery, and gives every sender the same
 * correlation identity.
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
 * Fixed Resend correlation tags carried by every auth magic-link message.
 * They are non-secret, carry no per-run data, and let providers recognize
 * the auth magic-link surface without parsing body content.
 */
export const accountMagicLinkEmailCategoryTag = "account-magic-link";
export const accountMagicLinkEmailSurface = "workspace";

/**
 * The fixed code of the one explicitly authorized bearer-material log line:
 * a protected Vercel Preview delivering to an exact synthetic E2E recipient
 * prints the rendered TEXT body (which carries the magic link) as a single
 * structured raw-`console.log` line under this code, outside the Effect/OTel
 * censorship layer. Never reached for non-synthetic recipients or outside
 * Preview.
 */
export const magicLinkPreviewE2ELogCode = "account.magic-link.preview-e2e";
