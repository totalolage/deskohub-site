import { getWorkspacePageUrl, type Locale, locales, m } from "@/features/i18n";
import {
  getWorkspaceCanonicalUrl,
  workspaceSiteConstants,
} from "./site-constants";
import { workspaceGoogleMapUrl } from "./workspace-location-map";

const schemaOrgContext = "https://schema.org";

/** A JSON-LD document of Schema.org nodes. */
export type StructuredDataDocument = {
  readonly "@context": typeof schemaOrgContext;
};

/** Starts a JSON-LD document of Schema.org nodes. */
export const getStructuredDataDocument = <Nodes extends object>(
  nodes: Nodes
): StructuredDataDocument & Nodes => ({
  "@context": schemaOrgContext,
  ...nodes,
});

/** The node every other Schema.org node references as the business. */
export const workspaceBusinessId = getWorkspaceCanonicalUrl("/#business");

/** The node that names the site in search results. */
export const workspaceWebSiteId = getWorkspaceCanonicalUrl("/#website");

const everyDayOfWeek = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
].map((day) => `https://schema.org/${day}`);

/** Hours that repeat every day from midnight until `closes`, Prague time. */
export const getEveryDayOpeningHours = (closes: string) => ({
  "@type": "OpeningHoursSpecification",
  dayOfWeek: everyDayOfWeek,
  opens: "00:00",
  closes,
});

/**
 * JSON-LD for an inline `<script type="application/ld+json">`. Escaping `<`
 * keeps any text value from closing the script element.
 */
export const serializeStructuredData = (data: StructuredDataDocument) =>
  JSON.stringify(data).replaceAll("<", "\\u003c");

/** The business behind every public page, in the visitor's language. */
export const getLocalBusinessStructuredData = ({
  image,
  locale,
  priceRange,
}: {
  /** An absolute URL of a photo of the space. */
  readonly image: string;
  readonly locale: Locale;
  /** The lowest to the highest catalog price, formatted for `locale`. */
  readonly priceRange?: string;
}) => {
  const { brand, company, contact, location, openingHours, social } =
    workspaceSiteConstants;

  return getStructuredDataDocument({
    "@type": "LocalBusiness",
    "@id": workspaceBusinessId,
    name: brand.name,
    legalName: brand.legalName,
    description: m.landingMetadataDescription({}, { locale }),
    url: getWorkspacePageUrl("/"),
    email: contact.infoEmail,
    image,
    logo: getWorkspaceCanonicalUrl("/favicon.png"),
    priceRange,
    taxID: company.taxIdentificationNumber,
    identifier: {
      "@type": "PropertyValue",
      propertyID: "IČO",
      value: company.identificationNumber,
    },
    address: {
      "@type": "PostalAddress",
      streetAddress: location.address.street,
      addressLocality: location.address.city,
      postalCode: location.address.postalCode,
      addressCountry: location.address.country,
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: location.coordinates.lat,
      longitude: location.coordinates.lng,
    },
    hasMap: workspaceGoogleMapUrl,
    sameAs: [social.instagram, social.facebook],
    // Schema.org writes a space that never closes as 00:00 to 23:59.
    ...(openingHours.alwaysOpen && {
      openingHoursSpecification: [getEveryDayOpeningHours("23:59")],
    }),
  });
};

/**
 * The site's name for search results, on the home page. Without it, Search
 * may label the subdomain with the name of `deskohub.cz`, the board game bar.
 * It must match the business name and `og:site_name`.
 */
export const getWebSiteStructuredData = () =>
  getStructuredDataDocument({
    "@type": "WebSite",
    "@id": workspaceWebSiteId,
    name: workspaceSiteConstants.brand.name,
    url: getWorkspacePageUrl("/"),
    inLanguage: [...locales],
    publisher: { "@id": workspaceBusinessId },
  });

/** One step of a breadcrumb trail: a page's short name and its URL. */
export type BreadcrumbListItem = {
  readonly name: string;
  /** The exact locale page, the same URL as its canonical. */
  readonly url: string;
};

/** Where a page sits in the site's hierarchy, from the home page down. */
export const getBreadcrumbListStructuredData = (
  items: ReadonlyArray<BreadcrumbListItem>
) =>
  getStructuredDataDocument({
    "@type": "BreadcrumbList",
    itemListElement: items.map(({ name, url }, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name,
      item: url,
    })),
  });
