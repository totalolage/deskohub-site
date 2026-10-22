import { describe, expect, test } from "bun:test";
import { workspaceMeetingRoomProductsByDurationKey } from "@/features/checkout/meeting-room-product-catalog";
import {
  getWorkspaceOfficeAccessPrice,
  getWorkspaceOfficeSeatPrice,
  getWorkspaceProductByTier,
  workspaceProductWorkstationAddonPrice,
} from "@/features/checkout/product-catalog";
import { getPublicCatalogOfferings } from "@/features/checkout/public-offerings";
import {
  toWorkspaceMoneyMajorAmount,
  type WorkspaceMoney,
} from "@/features/checkout/workspace-money";
import { type Locale, m } from "@/features/i18n";
import { getPublicOfferingsStructuredData } from "./public-offerings-structured-data";

const url = "https://workspace.deskohub.cz/reservation/cowork";
const business = { "@id": "https://workspace.deskohub.cz/#business" };

const getServices = (locale: Locale = "en-US") =>
  getPublicOfferingsStructuredData({
    locale,
    offerings: getPublicCatalogOfferings({
      locale,
      office: { maximumSeats: 4 },
    }),
    url,
  })["@graph"];

const getService = (name: string, locale: Locale = "en-US") => {
  const service = getServices(locale).find(
    (candidate) => candidate.name === name
  );
  if (!service) throw new Error(`Expected a ${name} service`);
  return service;
};

const unitPrice = (
  money: WorkspaceMoney,
  unitCode: "DAY" | "HUR",
  value = 1
) => ({
  "@type": "UnitPriceSpecification",
  price: toWorkspaceMoneyMajorAmount(money),
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
        offers: { "@type": "Offer", url, priceCurrency: "CZK" },
      });
    }
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
          price: toWorkspaceMoneyMajorAmount(
            workspaceProductWorkstationAddonPrice
          ),
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
