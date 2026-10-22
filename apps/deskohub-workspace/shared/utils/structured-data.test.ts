import { describe, expect, test } from "bun:test";
import { m } from "@/features/i18n";
import { workspaceSiteConstants } from "./site-constants";
import {
  getLocalBusinessStructuredData,
  serializeStructuredData,
  workspaceBusinessId,
} from "./structured-data";

const image = "https://workspace.deskohub.cz/_next/static/media/hero.jpeg";

describe("getLocalBusinessStructuredData", () => {
  test("describes the business from the site constants", () => {
    const { address, coordinates } = workspaceSiteConstants.location;
    const business = getLocalBusinessStructuredData({
      image,
      locale: "cs-CZ",
    });

    expect(business).toMatchObject({
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      "@id": "https://workspace.deskohub.cz/#business",
      name: workspaceSiteConstants.brand.name,
      description: m.landingMetadataDescription({}, { locale: "cs-CZ" }),
      url: "https://workspace.deskohub.cz/",
      email: workspaceSiteConstants.contact.infoEmail,
      image,
      address: {
        "@type": "PostalAddress",
        streetAddress: address.street,
        addressLocality: "Praha 8 - Libeň",
        postalCode: address.postalCode,
        addressCountry: "CZ",
      },
      geo: {
        "@type": "GeoCoordinates",
        latitude: coordinates.lat,
        longitude: coordinates.lng,
      },
      sameAs: [
        workspaceSiteConstants.social.instagram,
        workspaceSiteConstants.social.facebook,
      ],
    });
    expect(business["@id"]).toBe(workspaceBusinessId);
    // There is no business phone number to publish.
    expect(business).not.toHaveProperty("telephone");
  });

  test("is open around the clock every day", () => {
    expect(
      getLocalBusinessStructuredData({ image, locale: "en-US" })
        .openingHoursSpecification
    ).toEqual([
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: [
          "https://schema.org/Monday",
          "https://schema.org/Tuesday",
          "https://schema.org/Wednesday",
          "https://schema.org/Thursday",
          "https://schema.org/Friday",
          "https://schema.org/Saturday",
          "https://schema.org/Sunday",
        ],
        opens: "00:00",
        closes: "23:59",
      },
    ]);
  });
});

describe("serializeStructuredData", () => {
  test("keeps text from closing the script element", () => {
    const data = { name: "</script><script>alert(1)</script>" };
    const serialized = serializeStructuredData(data);

    expect(serialized).not.toContain("<");
    expect(serialized).toContain("\\u003c/script>");
    expect(JSON.parse(serialized)).toEqual(data);
  });
});
