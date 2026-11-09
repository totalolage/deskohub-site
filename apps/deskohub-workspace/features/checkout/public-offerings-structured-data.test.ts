import { describe, expect, test } from "bun:test";
import { workspaceMeetingRoomProductsByDurationKey } from "@/features/checkout/meeting-room-product-catalog";
import {
  getWorkspaceOfficeAccessPrice,
  getWorkspaceOfficeSeatPrice,
  getWorkspaceProductByTier,
  workspaceProductWorkstationAddonPrice,
} from "@/features/checkout/product-catalog";
import { getPublicCatalogOfferings } from "@/features/checkout/public-offerings";
import { type Locale, m } from "@/features/i18n";
import { currencyCZK } from "@/shared/money/currencies";
import { type Money, moneyMajorAmount } from "@/shared/money/money";
import { getPublicOfferingsStructuredData } from "./public-offerings-structured-data";

const bookingUrl = (path: string) => `https://workspace.deskohub.cz${path}`;
const business = { "@id": "https://workspace.deskohub.cz/#business" };

const getServices = (locale: Locale = "en-US") =>
  getPublicOfferingsStructuredData({
    locale,
    offerings: getPublicCatalogOfferings({
      locale,
      office: { maximumSeats: 4 },
    }),
  })["@graph"];

const getService = (name: string, locale: Locale = "en-US") => {
  const service = getServices(locale).find(
    (candidate) => candidate.name === name
  );
  if (!service) throw new Error(`Expected a ${name} service`);
  return service;
};

const unitPrice = (money: Money, unitCode: "DAY" | "HUR", value = 1) => ({
  "@type": "UnitPriceSpecification",
  price: moneyMajorAmount(money),
  priceCurrency: "CZK",
  unitCode,
  referenceQuantity: { "@type": "QuantitativeValue", value, unitCode },
});

describe("getPublicOfferingsStructuredData", () => {
  test("offers one service per bookable product from the business", () => {
    const services = getServices();

    expect(services.map(({ name }) => name)).toEqual([
      m.reservationOpenSpaceTitle({}, { locale: "en-US" }),
      m.reservationReservedDeskTitle({}, { locale: "en-US" }),
      "Meeting room - 1 hour",
      "Meeting room - 4 hours",
      "Meeting room - whole day",
      m.reservationOfficeProductTitle({}, { locale: "en-US" }),
    ]);
    for (const service of services) {
      expect(service).toMatchObject({
        "@type": "Service",
        provider: business,
        offers: { "@type": "Offer", priceCurrency: "CZK" },
      });
      expect(service.offers).not.toHaveProperty("priceValidUntil");
    }
  });

  test("offers each product on the page that books it", () => {
    expect(getServices().map(({ offers }) => offers.url)).toEqual([
      bookingUrl("/reservation/cowork"),
      bookingUrl("/reservation/cowork"),
      bookingUrl("/reservation/meeting-room"),
      bookingUrl("/reservation/meeting-room"),
      bookingUrl("/reservation/meeting-room"),
      bookingUrl("/reservation/office"),
    ]);
  });

  test("dates a sale price and strikes through the regular price beside it", () => {
    const [openSpace] = getPublicCatalogOfferings({ locale: "en-US" });
    if (!openSpace) throw new Error("Expected the Open Space offering");
    const [service] = getPublicOfferingsStructuredData({
      locale: "en-US",
      offerings: [
        {
          ...openSpace,
          advertisedPrice: {
            price: currencyCZK(21_750),
            discount: currencyCZK(7_250),
            saleLastDay: "2099-08-01",
          },
        },
      ],
    })["@graph"];

    expect(service?.offers).toMatchObject({
      price: 217.5,
      priceValidUntil: "2099-08-01",
      priceSpecification: [
        unitPrice(currencyCZK(21_750), "DAY"),
        {
          ...unitPrice(currencyCZK(29_000), "DAY"),
          priceType: "https://schema.org/StrikethroughPrice",
        },
      ],
    });
  });

  test("keeps the regular price without a sale", () => {
    const [openSpace] = getPublicCatalogOfferings({ locale: "en-US" });
    if (!openSpace) throw new Error("Expected the Open Space offering");
    const [service] = getPublicOfferingsStructuredData({
      locale: "en-US",
      offerings: [
        {
          ...openSpace,
          advertisedPrice: {
            price: openSpace.price,
            discount: currencyCZK(0),
          },
        },
      ],
    })["@graph"];

    expect(service?.offers).toMatchObject({
      price: 290,
      priceSpecification: [unitPrice(openSpace.price, "DAY")],
    });
    expect(service?.offers).not.toHaveProperty("priceValidUntil");
  });

  test("prices each cowork tier per day with its paid extras", () => {
    const openSpacePrice = getWorkspaceProductByTier("open-space").price;
    const reservedDeskPrice = getWorkspaceProductByTier("reserved-desk").price;
    const openSpace = getService(
      m.reservationOpenSpaceTitle({}, { locale: "en-US" })
    );
    const reservedDesk = getService(
      m.reservationReservedDeskTitle({}, { locale: "en-US" })
    );

    expect(openSpace.offers).toMatchObject({
      price: 290,
      priceSpecification: [unitPrice(openSpacePrice, "DAY")],
      addOn: [
        {
          "@type": "Offer",
          name: m.reservationCoffeeLabel({}, { locale: "en-US" }),
          price: 50,
          priceCurrency: "CZK",
        },
      ],
    });
    expect(reservedDesk.offers).toMatchObject({
      price: 410,
      priceSpecification: [unitPrice(reservedDeskPrice, "DAY")],
      // Coffee is included in the Reserved Desk price.
      addOn: [
        {
          name: m.reservationWorkstationLabel({}, { locale: "en-US" }),
          price: moneyMajorAmount(workspaceProductWorkstationAddonPrice),
        },
      ],
    });
  });

  test("limits Open Space to its daily hours", () => {
    const [openSpace, reservedDesk] = getServices();

    expect(openSpace).toMatchObject({
      hoursAvailable: {
        "@type": "OpeningHoursSpecification",
        opens: "00:00",
        closes: "17:00",
      },
    });
    expect(openSpace?.hoursAvailable?.dayOfWeek).toHaveLength(7);
    expect(reservedDesk).not.toHaveProperty("hoursAvailable");
  });

  test("prices meeting rooms per booked hours or per day", () => {
    expect(
      getServices()
        .slice(2, 5)
        .map(({ offers }) => offers.priceSpecification)
    ).toEqual([
      [
        unitPrice(
          workspaceMeetingRoomProductsByDurationKey["hour:1"].price,
          "HUR",
          1
        ),
      ],
      [
        unitPrice(
          workspaceMeetingRoomProductsByDurationKey["hour:4"].price,
          "HUR",
          4
        ),
      ],
      [
        unitPrice(
          workspaceMeetingRoomProductsByDurationKey["day:1"].price,
          "DAY"
        ),
      ],
    ]);
    expect(getServices()[2]?.offers.price).toBe(350);
  });

  test("prices the office per day plus each reserved seat per day", () => {
    const office = getService(
      m.reservationOfficeProductTitle({}, { locale: "en-US" })
    );

    expect(office.offers).toMatchObject({
      price: 530,
      priceSpecification: [
        unitPrice(getWorkspaceOfficeAccessPrice(1), "DAY"),
        {
          ...unitPrice(getWorkspaceOfficeSeatPrice(1), "DAY"),
          name: m.publicOfferingOfficeSeatPrice({}, { locale: "en-US" }),
        },
      ],
    });
    expect(office.offers).not.toHaveProperty("addOn");
  });

  test("writes names and descriptions in the page language", () => {
    const [openSpace] = getServices("cs-CZ");

    expect(openSpace).toMatchObject({
      name: m.reservationOpenSpaceTitle({}, { locale: "cs-CZ" }),
      description: m.reservationOpenSpaceDescription(
        { until: "17:00" },
        { locale: "cs-CZ" }
      ),
      offers: {
        description: m.publicOfferingOpenSpaceUsage(
          { until: "17:00" },
          { locale: "cs-CZ" }
        ),
      },
    });
  });
});
