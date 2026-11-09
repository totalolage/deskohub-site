import { describe, expect, test } from "bun:test";
import type { CustomerCheckoutSummary } from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import type { AppLocale } from "../../i18n/app-locale";
import {
  elementTree,
  findAll,
  hostTree,
  textOf,
} from "../../ui/testing/element-tree";
import { summaryView } from "../checkout-screen/review-view";
import { czk } from "../testing/sample-booking-catalog";
import { PriceSummary } from "./price-summary";

/**
 * An office checkout summary as the Workspace sends it: `seatAmount` is one
 * seat's price for the days booked, not the seats' total.
 */
const officeSummary = ({
  dayCount,
  seats,
  access,
  seat,
}: {
  readonly dayCount: number;
  readonly seats: number;
  readonly access: number;
  readonly seat: number;
}): CustomerCheckoutSummary => {
  const total = czk(access + seat * seats);
  return {
    sections: [
      {
        key: "order",
        items: [
          {
            key: "product:office",
            amount: total,
            dayCount,
            seats,
            accessAmount: czk(access),
            seatAmount: czk(seat),
          },
        ],
        total,
      },
      { key: "total", items: [{ key: "total:final", amount: total }], total },
    ],
    total,
  };
};

/** Every Text's content in render order. */
const texts = (summary: CustomerCheckoutSummary, locale: AppLocale) =>
  findAll(
    hostTree(
      elementTree(PriceSummary, {
        summary: summaryView(summary, Option.none()),
        lineLabel: () => "office",
        locale,
      })
    ),
    "Text"
  ).map(textOf);

describe("PriceSummary office breakdown", () => {
  test.each([
    {
      case: "1 day, 2 seats",
      summary: officeSummary({ dayCount: 1, seats: 2, access: 530, seat: 315 }),
      enUS: ["CZK 530", "CZK 630", "CZK 1,160"],
      csCZ: ["530 Kč", "630 Kč", "1 160 Kč"],
    },
    {
      case: "2 days, 3 seats",
      summary: officeSummary({
        dayCount: 2,
        seats: 3,
        access: 1060,
        seat: 630,
      }),
      enUS: ["CZK 1,060", "CZK 1,890", "CZK 2,950"],
      csCZ: ["1 060 Kč", "1 890 Kč", "2 950 Kč"],
    },
  ])("$case: the days and seats amounts add up to the total", (row) => {
    for (const [locale, [days, seats, total]] of [
      ["en-US", row.enUS],
      ["cs-CZ", row.csCZ],
    ] as const) {
      const shown = texts(row.summary, locale).map((text) =>
        text.replace(/\s/g, " ")
      );
      // Line amount, days, seats, then the total.
      expect(shown.filter((text) => /CZK|Kč/.test(text))).toEqual([
        total,
        days,
        seats,
        total,
      ]);
    }
  });
});
