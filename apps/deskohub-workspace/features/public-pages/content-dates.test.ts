import { describe, expect, test } from "bun:test";
import type { Locale } from "@/features/i18n";
import {
  getLegalDocument,
  type LegalDocumentKey,
} from "@/features/legal/content";
import { publicPageContentDates } from "./content-dates";
import { publicPages } from "./public-pages";

const legalDocumentKeys = [
  "terms-and-conditions",
  "privacy-policy",
  "cookie-policy",
  "operating-rules",
  "marketing-communications",
] as const satisfies ReadonlyArray<LegalDocumentKey>;

// The legal pages print their date in each locale's long form; English uses
// the day-first form.
const dateFormatLocale = {
  "en-US": "en-GB",
  "cs-CZ": "cs-CZ",
} as const satisfies Record<Locale, string>;

const longDate = (isoDate: string, locale: Locale) =>
  new Intl.DateTimeFormat(dateFormatLocale[locale], {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T12:00:00Z`));

describe("public page content dates", () => {
  test("date every registered page with a calendar day that has passed", () => {
    const today = Temporal.Now.plainDateISO("Europe/Prague");

    for (const { pathname } of publicPages) {
      const date = Temporal.PlainDate.from(publicPageContentDates[pathname]);
      expect(date.toString()).toBe(publicPageContentDates[pathname]);
      expect(Temporal.PlainDate.compare(date, today)).toBeLessThanOrEqual(0);
    }
  });

  test("date each legal page by its document's last update in every locale", () => {
    for (const documentKey of legalDocumentKeys) {
      for (const locale of ["en-US", "cs-CZ"] as const) {
        expect(getLegalDocument(locale, documentKey).updatedAt).toBe(
          longDate(publicPageContentDates[`/${documentKey}`], locale)
        );
      }
    }
  });
});
