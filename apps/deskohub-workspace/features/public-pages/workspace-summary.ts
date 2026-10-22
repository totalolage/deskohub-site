import {
  getPublicCatalogOfferings,
  type PublicCatalogOffering,
} from "@/features/checkout/public-offerings";
import type { GlobalRelease } from "@/features/feature-flags/backend/global-release";
import { type Locale, m } from "@/features/i18n";
import { joinSentences } from "@/shared/utils/sentences";
import {
  type WorkspaceOpeningHours,
  workspaceSiteConstants,
} from "@/shared/utils/site-constants";
import { workspaceFormattedAddress } from "@/shared/utils/workspace-location-map";

/**
 * The business in one paragraph, as the site metadata and `llms.txt`
 * describe it: the address, each offered product once in catalog order, and
 * whether the space is always open.
 */
export const getWorkspaceSummary = ({
  locale,
  offerings,
  openingHours = workspaceSiteConstants.openingHours,
}: {
  readonly locale: Locale;
  /** The products to name; a product offered in several durations repeats. */
  readonly offerings: ReadonlyArray<Pick<PublicCatalogOffering, "name">>;
  readonly openingHours?: Pick<WorkspaceOpeningHours, "alwaysOpen">;
}) =>
  joinSentences(
    m.workspaceMetadataDescription(
      {
        address: workspaceFormattedAddress,
        products: new Intl.ListFormat(locale, { type: "conjunction" }).format(
          new Set(offerings.map(({ name }) => name))
        ),
      },
      { locale }
    ),
    openingHours.alwaysOpen && m.workspaceMetadataAlwaysOpen({}, { locale })
  );

/**
 * The summary every visitor gets, from the catalog: it names the office only
 * while office reservations are open for everyone.
 */
export const getSharedWorkspaceSummary = ({
  locale,
  officeRelease,
}: {
  readonly locale: Locale;
  readonly officeRelease: GlobalRelease;
}) =>
  getWorkspaceSummary({
    locale,
    offerings: getPublicCatalogOfferings({
      locale,
      ...(officeRelease === "on" && { office: {} }),
    }),
  });
