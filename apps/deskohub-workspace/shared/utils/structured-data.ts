import { getWorkspacePageUrl, type Locale, m } from "@/features/i18n";
import {
  getWorkspaceCanonicalUrl,
  workspaceSiteConstants,
} from "./site-constants";

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
}: {
  /** An absolute URL of a photo of the space. */
  readonly image: string;
  readonly locale: Locale;
}) => {
  const { brand, contact, location, openingHours, social } =
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
    address: {
      "@type": "PostalAddress",
      streetAddress: location.address.street,
      addressLocality: `${location.address.city} - ${location.address.cityDistrict}`,
      postalCode: location.address.postalCode,
      addressCountry: location.address.country,
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: location.coordinates.lat,
      longitude: location.coordinates.lng,
    },
    sameAs: [social.instagram, social.facebook],
    // Schema.org writes a space that never closes as 00:00 to 23:59.
    ...(openingHours.alwaysOpen && {
      openingHoursSpecification: [getEveryDayOpeningHours("23:59")],
    }),
  });
};
