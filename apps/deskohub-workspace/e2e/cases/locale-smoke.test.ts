import { expect, test } from "bun:test";
import {
  baseLocale,
  matchSupportedLocale,
  supportedLocales,
} from "@deskohub/i18n/locale-registry";
import { formatWorkspaceE2EFailureAnnotation } from "../github-actions";
import { workspaceE2ECaseIds } from "../playwright-checkout/case-catalog";
import {
  expectedHomeAlternates,
  localeHomeHeading,
  localeSmokeCaseId,
  localeSmokeLocales,
  localeSmokePlans,
} from "./locale-smoke";

test("smoke-tests every supported locale the locale-switch case does not", () => {
  expect([...localeSmokeLocales, "cs-CZ", "en-US"].toSorted()).toEqual(
    [...supportedLocales].toSorted()
  );
  for (const locale of localeSmokeLocales) {
    expect(workspaceE2ECaseIds).toContain(localeSmokeCaseId(locale));
  }
});

test("keeps every smoke case ID readable in the CI failure annotation", () => {
  for (const locale of localeSmokeLocales) {
    const annotation = formatWorkspaceE2EFailureAnnotation({
      caseId: localeSmokeCaseId(locale),
      failureKind: "error",
      outcome: "failed",
    });

    expect(annotation).toContain(`case=${localeSmokeCaseId(locale)},`);
  }
});

test("probes only Accept-Language values the registry matches to the smoke locale", () => {
  for (const locale of localeSmokeLocales) {
    for (const language of localeSmokePlans[locale].acceptLanguages) {
      expect(matchSupportedLocale(language)).toBe(locale);
    }
  }
});

test("switches through every smoke locale once", () => {
  const targets = localeSmokeLocales.map(
    (locale) => localeSmokePlans[locale].switchesTo
  );

  expect(targets.toSorted()).toEqual([...localeSmokeLocales].toSorted());
  for (const locale of localeSmokeLocales) {
    expect(localeSmokePlans[locale].switchesTo).not.toBe(locale);
  }
});

test("each smoke locale's home heading tells it apart from the fallback locales", () => {
  for (const locale of localeSmokeLocales) {
    expect(localeHomeHeading(locale)).not.toBe(localeHomeHeading(baseLocale));
    expect(localeHomeHeading(locale)).not.toBe(localeHomeHeading("cs-CZ"));
  }
});

test("expects an hreflang alternate per supported locale plus x-default", () => {
  const alternates = new Map(expectedHomeAlternates());

  expect(alternates.size).toBe(supportedLocales.length + 1);
  expect(alternates.get("x-default")).toBe("/");
  for (const locale of supportedLocales) {
    expect(alternates.get(locale)).toBe(`/${locale}`);
  }
});
