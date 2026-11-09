// Intl checks that depend on the engine's Intl backend, which differs between
// Hermes on Android, Hermes on iOS and the web. Expected values are the known
// results from Node and Bun, written out rather than recomputed here.
import {
  formatCurrencyAmount,
  formatCurrencyName,
} from "@deskohub/i18n/currency";
import { getLocalTimeInTimezone } from "@deskohub/reservation";
import { DateTime, Option } from "effect";
import {
  formatInstantRange,
  formatWorkspaceDays,
} from "../i18n/date-time-format";
import type { SmokeCase } from "./smoke-case";
import { assertSmoke } from "./smoke-case";

// Monday 2026-01-05 09:30 UTC is 10:30 in Europe/Prague (CET, UTC+1).
const mondayMorning = new Date(Date.UTC(2026, 0, 5, 9, 30));

export const intlSmokeCases: ReadonlyArray<SmokeCase> = [
  {
    group: "intl",
    name: "date-time-format-parts-europe-prague",
    run: () => {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Europe/Prague",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
        .formatToParts(mondayMorning)
        .filter((part) => part.type !== "literal")
        .map((part) => `${part.type}=${part.value}`)
        .join(" ");
      assertSmoke(parts === "weekday=Mon hour=10 minute=30", parts);
      return parts;
    },
  },
  {
    group: "intl",
    name: "reservation-local-time-europe-prague",
    run: () => {
      const localTime = JSON.stringify(
        getLocalTimeInTimezone(mondayMorning, "Europe/Prague")
      );
      assertSmoke(
        localTime ===
          '{"dayOfWeek":1,"hours":10,"minutes":30,"timeString":"10:30"}',
        localTime
      );
      return localTime;
    },
  },
  {
    group: "intl",
    name: "reservation-days-europe-prague",
    run: () => {
      // 30 November 00:00 Prague to 1 December 00:00, and to 17:00 that day.
      const start = DateTime.makeUnsafe("2026-11-29T23:00:00Z");
      const days = [
        formatInstantRange(
          start,
          DateTime.makeUnsafe("2026-11-30T23:00:00Z"),
          "en-US"
        ),
        formatWorkspaceDays(
          start,
          DateTime.makeUnsafe("2026-11-30T16:00:00Z"),
          "cs-CZ"
        ),
      ]
        .map((range) => [range.start, ...Option.toArray(range.end)].join(" – "))
        .join(" | ");
      assertSmoke(
        days === "Monday, November 30, 2026 | pondělí 30. listopadu 2026",
        `got ${JSON.stringify(days)}`
      );
      return days;
    },
  },
  {
    group: "intl",
    name: "currency-amount-czk",
    run: () => {
      const amount = formatCurrencyAmount({
        amount: "1234.50",
        currency: "CZK",
        locale: "cs-CZ",
      });
      // ICU separates Czech thousands and the currency sign with no-break spaces.
      assertSmoke(
        amount === "1\u00a0234,50\u00a0Kč",
        `got ${JSON.stringify(amount)}`
      );
      return amount;
    },
  },
  {
    group: "intl",
    name: "currency-amount-exact-decimal",
    run: () => {
      // V8 and Bun format decimal text digit for digit; Hermes converts it to
      // a double first, so only amounts within double precision stay exact.
      const exactDecimalText =
        new Intl.NumberFormat("en-US", { useGrouping: false }).format(
          "9007199254740993"
        ) === "9007199254740993";
      const realistic = formatCurrencyAmount({
        amount: "9007199254740.99",
        currency: "CZK",
        locale: "cs-CZ",
      });
      assertSmoke(
        realistic === "9\u00a0007\u00a0199\u00a0254\u00a0740,99\u00a0Kč",
        `got ${JSON.stringify(realistic)}`
      );
      if (exactDecimalText) {
        // Past Number.MAX_SAFE_INTEGER: a double would round this to ...568,00.
        const large = formatCurrencyAmount({
          amount: "12345678901234567.89",
          currency: "CZK",
          locale: "cs-CZ",
        });
        assertSmoke(
          large ===
            "12\u00a0345\u00a0678\u00a0901\u00a0234\u00a0567,89\u00a0Kč",
          `got ${JSON.stringify(large)}`
        );
      }
      return `${realistic} (exact decimal text ${exactDecimalText ? "supported" : "unsupported"})`;
    },
  },
  {
    group: "intl",
    name: "currency-name-czk",
    run: () => {
      // Hermes has no Intl.DisplayNames; the helper then names the ISO code.
      const hasDisplayNames = typeof Intl.DisplayNames === "function";
      const name = formatCurrencyName({ currency: "CZK", locale: "cs" });
      assertSmoke(
        name === (hasDisplayNames ? "česká koruna" : "CZK"),
        `got ${JSON.stringify(name)} with Intl.DisplayNames ${hasDisplayNames ? "present" : "missing"}`
      );
      return `${name} (Intl.DisplayNames ${hasDisplayNames ? "present" : "missing"})`;
    },
  },
];
