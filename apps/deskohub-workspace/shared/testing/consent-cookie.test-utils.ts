import { getConsentBannerRevision } from "@/features/legal/consent-banner-revision";
import { CONSENT_COOKIE_NAME } from "@/shared/utils/consent-cookie";

/** The fields of a consent cookie as vanilla-cookieconsent saves it. */
type SavedConsentFields = {
  readonly categories: readonly unknown[];
  /** Defaults to the current banner revision. */
  readonly revision?: unknown;
  readonly lastConsentTimestamp?: unknown;
  readonly languageCode?: string;
};

/**
 * The URI-encoded value of a consent cookie saved under the current banner
 * revision, unless `fields` names another.
 */
export const savedConsentCookieValue = (fields: SavedConsentFields): string =>
  encodeURIComponent(
    JSON.stringify({ revision: getConsentBannerRevision(), ...fields })
  );

/** A `Cookie` header pair for a consent cookie saved under the current revision. */
export const savedConsentCookie = (fields: SavedConsentFields): string =>
  `${CONSENT_COOKIE_NAME}=${savedConsentCookieValue(fields)}`;
