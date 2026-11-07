// Intl checks that depend on the engine's Intl backend, which differs between
// Hermes on Android, Hermes on iOS and the web. Expected values are the known
// results from Node and Bun, written out rather than recomputed here.
import { formatCurrencyAmount, formatCurrencyName } from "@deskohub/i18n/currency";
import { getLocalTimeInTimezone } from "@deskohub/reservation";
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
    name: "currency-amount-czk",
    run: () => {
      const amount = formatCurrencyAmount({
        amount: "1234.50",
        currency: "CZK",
        locale: "cs-CZ",
      });
      // ICU separates Czech thousands and the currency sign with no-break spaces.
      assertSmoke(
        amount === "1 234,50 Kč",
        `got ${JSON.stringify(amount)}`
      );
      return amount;
    },
  },
  {
    group: "intl",
    name: "currency-name-czk",
    run: () => {
      // Hermes has no Intl.DisplayNames; the helper then names the ISO code.
      const hasDisplayNames = "DisplayNames" in Intl;
      const name = formatCurrencyName({ currency: "CZK", locale: "cs" });
      assertSmoke(
        name === (hasDisplayNames ? "česká koruna" : "CZK"),
        `got ${JSON.stringify(name)} with Intl.DisplayNames ${hasDisplayNames ? "present" : "missing"}`
      );
      return `${name} (Intl.DisplayNames ${hasDisplayNames ? "present" : "missing"})`;
    },
  },
];
