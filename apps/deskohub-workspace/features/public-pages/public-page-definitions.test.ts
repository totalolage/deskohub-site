import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { type Locale, locales } from "@/features/i18n";
import {
  getLegalDocument,
  type LegalDocumentKey,
} from "@/features/legal/content";
import { legalTranslationDates } from "@/features/legal/legal-translation-dates";
import { runtimeImportGraph } from "@/shared/testing/runtime-import-graph.test-utils";
import { workspaceSiteConstants } from "@/shared/utils";
import { publicPageDefinitions, publicPages } from "./public-page-definitions";

const workspaceRoot = resolve(import.meta.dir, "../..");
const renderingPackage = /^(react|react-dom|server-only|next)(\/|$)/;

test("the registry loads no rendering or server-only modules", async () => {
  const { modules, packages } = await runtimeImportGraph(
    resolve(import.meta.dir, "public-page-definitions.ts"),
    workspaceRoot
  );

  expect(modules.length).toBeGreaterThan(1);
  expect(modules.filter((module) => module.endsWith(".tsx"))).toEqual([]);
  expect(packages.filter((name) => renderingPackage.test(name))).toEqual([]);
});

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
  "de-DE": "de-DE",
  "uk-UA": "uk-UA",
  "sk-SK": "sk-SK",
} as const satisfies Record<Locale, string>;

const longDate = (isoDate: string, locale: Locale) =>
  new Intl.DateTimeFormat(dateFormatLocale[locale], {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T12:00:00Z`));

describe("public page content dates", () => {
  test("date every page with a calendar day that has passed", () => {
    const today = Temporal.Now.plainDateISO("Europe/Prague");

    for (const { contentDate, localeContentDates } of publicPages) {
      for (const isoDate of [
        contentDate,
        ...Object.values(localeContentDates ?? {}),
      ]) {
        const date = Temporal.PlainDate.from(isoDate);
        expect(date.toString()).toBe(isoDate);
        expect(Temporal.PlainDate.compare(date, today)).toBeLessThanOrEqual(0);
      }
    }
  });

  test("date each legal page by its document's last update in every locale", () => {
    for (const documentKey of legalDocumentKeys) {
      for (const locale of locales) {
        expect(getLegalDocument(locale, documentKey).updatedAt).toBe(
          longDate(publicPageDefinitions[`/${documentKey}`].contentDate, locale)
        );
      }
    }
  });

  // A translated locale's legal text can change, as its translation notice
  // did, without a new Czech version or document date.
  test("date each legal page in a translated locale by its translation too", () => {
    for (const documentKey of legalDocumentKeys) {
      expect(
        publicPageDefinitions[`/${documentKey}`].localeContentDates
      ).toEqual(legalTranslationDates);
    }
  });
});

describe("public page titles and descriptions", () => {
  // The document title appends the site name to the page's own title.
  test("title every page in every locale without the site name", () => {
    for (const { title } of publicPages) {
      for (const locale of locales) {
        const pageTitle = title({}, { locale });
        expect(pageTitle.trim()).not.toBe("");
        expect(pageTitle).not.toContain(workspaceSiteConstants.brand.name);
      }
    }
  });

  test("describe every page in every locale", () => {
    for (const { description } of publicPages) {
      for (const locale of locales) {
        expect(description?.({}, { locale }).trim()).toBeTruthy();
      }
    }
  });
});
