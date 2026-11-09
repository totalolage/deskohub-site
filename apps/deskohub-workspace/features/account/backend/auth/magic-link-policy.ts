import { isTestEmailAddress } from "@deskohub/test-email";

/**
 * Only `delivered+<run-id>-<label>@<EMAIL_TEST_DOMAIN>` is a synthetic E2E
 * account. Every test-domain recipient is logged by Console, but only this
 * shape may enter the Preview bearer-log route.
 */
const magicLinkSyntheticLocalPartPattern =
  /^delivered\+[a-z0-9]+(?:-[a-z0-9]+)*-[a-z0-9]+$/i;

export const isSyntheticE2EEmailRecipient = (email: string): boolean =>
  isTestEmailAddress(email) &&
  magicLinkSyntheticLocalPartPattern.test(
    email.slice(0, email.lastIndexOf("@"))
  );

/**
 * Code for the sole authorized bearer-link log in synthetic protected Preview.
 */
export const magicLinkPreviewE2ELogCode = "account.magic-link.preview-e2e";

/**
 * Code for the bearer-link log in local `next dev`, where Console delivery
 * would otherwise leave the developer without a link.
 */
export const magicLinkDevelopmentLogCode = "account.magic-link.development";

/** Non-secret correlation identity shared by Workspace magic-link messages. */
export const accountMagicLinkEmailCategoryTag = "account-magic-link";
export const accountMagicLinkEmailSurface = "workspace";
