import type {
  CustomerBookingOfferings,
  CustomerBookingSelection,
  CustomerCheckoutSummary,
  CustomerLegalDocument,
  CustomerLocale,
  CustomerOffering,
  Money,
} from "@deskohub/workspace-customer-api";
import { daysBetween, type PragueDate } from "../selection/prague-date";

/**
 * Synthetic booking catalog for the fake Workspace: offerings, prices and
 * legal documents. Nothing here is real customer or price data.
 */

/** Whole Czech crowns as the contract's minor-unit money. */
export const czk = (crowns: number): Money => ({
  value: Math.round(crowns * 100),
  exponent: 2,
  currency: "CZK",
});

const noSale = { discount: czk(0) };

const copy = (locale: CustomerLocale, en: string, cs: string) =>
  locale === "cs-CZ" ? cs : en;

/** Per-day and per-booking prices the fake quotes, in crowns. */
export const samplePrices = {
  openSpace: 350,
  reservedDesk: 550,
  coffee: 50,
  workstation: 150,
  meetingRoom: { "hour:1": 400, "hour:4": 1200, "day:1": 2400 },
  officeDay: 1200,
  officeSeat: 250,
} as const;

export const sampleOfficeMaximumSeats = 6;
export const sampleOfficeMaximumDurationHours = 672;

export const sampleOfferings = (
  locale: CustomerLocale,
  advertisedOn: string
): CustomerBookingOfferings => {
  const offerings: ReadonlyArray<CustomerOffering> = [
    {
      family: "cowork",
      tier: "open-space",
      name: copy(locale, "Open Space", "Open Space"),
      description: copy(
        locale,
        "Any free desk in the shared room.",
        "Libovolný volný stůl ve sdílené místnosti."
      ),
      usage: copy(locale, "Weekdays 8:00–18:00.", "Všední dny 8:00–18:00."),
      price: czk(samplePrices.openSpace),
      advertisedPrice: { price: czk(samplePrices.openSpace), ...noSale },
      addOns: [
        {
          id: "coffee",
          name: copy(locale, "Coffee", "Káva"),
          price: czk(samplePrices.coffee),
          included: false,
        },
      ],
    },
    {
      family: "cowork",
      tier: "reserved-desk",
      name: copy(locale, "Reserved Desk", "Rezervovaný stůl"),
      description: copy(
        locale,
        "Your own desk for the day.",
        "Vlastní stůl na celý den."
      ),
      usage: copy(locale, "Weekdays 8:00–18:00.", "Všední dny 8:00–18:00."),
      price: czk(samplePrices.reservedDesk),
      advertisedPrice: { price: czk(samplePrices.reservedDesk), ...noSale },
      addOns: [
        {
          id: "coffee",
          name: copy(locale, "Coffee", "Káva"),
          price: czk(0),
          included: true,
        },
        {
          id: "workstation",
          name: copy(locale, "Monitor workstation", "Pracovní stanice"),
          price: czk(samplePrices.workstation),
          included: false,
          options: [
            { id: "2x27-qhd", name: '2× 27" QHD' },
            { id: "2x32-qhd", name: '2× 32" QHD' },
            { id: "2x27-4k", name: '2× 27" 4K' },
            { id: "2x32-4k", name: '2× 32" 4K' },
          ],
        },
      ],
    },
    ...(["hour:1", "hour:4", "day:1"] as const).map(
      (duration): CustomerOffering => ({
        family: "meeting-room",
        duration,
        durationLabel: {
          "hour:1": copy(locale, "1 hour", "1 hodina"),
          "hour:4": copy(locale, "4 hours", "4 hodiny"),
          "day:1": copy(locale, "Whole day", "Celý den"),
        }[duration],
        name: copy(locale, "Meeting room", "Zasedací místnost"),
        description: copy(
          locale,
          "A room for up to eight people.",
          "Místnost až pro osm lidí."
        ),
        usage: copy(locale, "Book by the hour.", "Rezervace po hodinách."),
        price: czk(samplePrices.meetingRoom[duration]),
        advertisedPrice: {
          price: czk(samplePrices.meetingRoom[duration]),
          ...noSale,
        },
      })
    ),
    {
      family: "office",
      name: copy(locale, "Private office", "Soukromá kancelář"),
      description: copy(
        locale,
        "A lockable office for your team.",
        "Uzamykatelná kancelář pro váš tým."
      ),
      usage: copy(locale, "Book whole days.", "Rezervace na celé dny."),
      price: czk(samplePrices.officeDay),
      seatPrice: czk(samplePrices.officeSeat),
      maximumSeats: sampleOfficeMaximumSeats,
      maximumDurationHours: sampleOfficeMaximumDurationHours,
      advertisedPrice: {
        price: czk(samplePrices.officeDay + samplePrices.officeSeat),
        ...noSale,
      },
    },
  ];
  return {
    advertisedOn,
    openingHours: copy(
      locale,
      "Monday to Friday, 8:00–18:00",
      "Pondělí až pátek, 8:00–18:00"
    ),
    offerings,
  };
};

/** One summary line before discounts. */
interface PricedLine {
  readonly key: string;
  readonly crowns: number;
  readonly dayCount?: number;
  readonly seats?: number;
}

/** Inclusive Prague days between two plain dates. */
export const inclusiveDays = (from: PragueDate, to: PragueDate) =>
  daysBetween(from, to) + 1;

/** The summary lines a complete selection is priced with, in crowns. */
export const pricedLines = (
  selection: CustomerBookingSelection
): ReadonlyArray<PricedLine> => {
  if (selection.family === "cowork") {
    const tier = selection.tier ?? "open-space";
    return [
      {
        key: `product:cowork-${tier}`,
        crowns:
          tier === "open-space"
            ? samplePrices.openSpace
            : samplePrices.reservedDesk,
      },
      ...(tier === "open-space" && selection.coffee === true
        ? [{ key: "addon:coffee", crowns: samplePrices.coffee }]
        : []),
      ...(tier === "reserved-desk" && selection.monitorOption !== undefined
        ? [
            {
              key: `monitor:${selection.monitorOption}`,
              crowns: samplePrices.workstation,
            },
          ]
        : []),
    ];
  }
  if (selection.family === "meeting-room") {
    const duration = selection.duration ?? "hour:1";
    return [
      {
        key: `product:meeting-room-${duration}`,
        crowns: samplePrices.meetingRoom[duration],
      },
    ];
  }
  const dayCount = inclusiveDays(
    selection.date,
    selection.endDate ?? selection.date
  );
  const seats = selection.seats ?? 1;
  return [
    {
      key: "product:office",
      crowns:
        dayCount * (samplePrices.officeDay + seats * samplePrices.officeSeat),
      dayCount,
      seats,
    },
  ];
};

/**
 * The checkout summary for priced lines, taking `discountShare` (0 to 1) off
 * every product line and adding `surcharge` crowns to the first line, as a
 * price change does.
 */
export const sampleSummary = ({
  lines,
  discountShare = 0,
  discountLabel = "",
  surcharge = 0,
}: {
  readonly lines: ReadonlyArray<PricedLine>;
  readonly discountShare?: number;
  readonly discountLabel?: string;
  readonly surcharge?: number;
}): CustomerCheckoutSummary => {
  const items = lines.map((line, index) => {
    const original = line.crowns + (index === 0 ? surcharge : 0);
    const off = Math.round(original * discountShare);
    return {
      key: line.key,
      amount: czk(original - off),
      ...(off > 0
        ? {
            originalAmount: czk(original),
            discounts: [
              {
                discount: { id: "sample-code", label: discountLabel },
                amount: czk(off),
              },
            ],
          }
        : {}),
      ...(line.dayCount === undefined ? {} : { dayCount: line.dayCount }),
      ...(line.seats === undefined ? {} : { seats: line.seats }),
    };
  });
  const total = czk(
    items.reduce((sum, item) => sum + item.amount.value, 0) / 100
  );
  return {
    sections: [
      { key: "order", items, total },
      { key: "total", items: [{ key: "total:final", amount: total }], total },
    ],
    total,
  };
};

const sampleHash = (seed: string, version: number) =>
  `${seed}${version.toString(16).padStart(8, "0")}`;

/** The published legal documents at `version`; a new version changes the hashes. */
export const sampleLegalDocuments = (
  locale: CustomerLocale,
  version: number
): ReadonlyArray<CustomerLegalDocument> => [
  {
    key: "terms-and-conditions",
    path: locale === "cs-CZ" ? "/obchodni-podminky" : "/en-US/terms",
    hash: sampleHash(
      "3f6c0b1e9a7d4c2b8e5f1a0d7c6b9e2f4a1d8c7b6e5f0a9d3c2b1e8f",
      version
    ),
    hashAlgorithm: "sha256",
  },
  {
    key: "operating-rules",
    path: locale === "cs-CZ" ? "/provozni-rad" : "/en-US/operating-rules",
    hash: sampleHash(
      "9b2e7d4a1c8f6e3b0d5a2c9f7e4b1d8a6c3f0e7b4d1a9c6f3e0b7d4a",
      version
    ),
    hashAlgorithm: "sha256",
  },
];
