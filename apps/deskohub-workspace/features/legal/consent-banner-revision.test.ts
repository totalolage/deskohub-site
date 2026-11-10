import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { type Locale, locales } from "@/features/i18n";
import {
  consentBannerDocumentVersions,
  getConsentBannerRevision,
} from "./consent-banner-revision";
import { getLegalDocumentVersion } from "./document-version";
import type { LegalDocumentKey } from "./legal-document-summaries";

const documentKeys: readonly LegalDocumentKey[] = [
  "privacy-policy",
  "cookie-policy",
  "terms-and-conditions",
  "marketing-communications",
  "operating-rules",
];

/** Published versions where one document of one locale was edited. */
const versionsWithEdit =
  (edited?: { readonly locale: Locale; readonly documentKey: string }) =>
  (locale: Locale, documentKey: LegalDocumentKey) =>
    edited?.locale === locale && edited.documentKey === documentKey
      ? `${locale}-${documentKey}-edited`
      : `${locale}-${documentKey}`;

test("the banner is bound to the published privacy notice and cookie policy of every locale", () => {
  // On failure, copy the received versions into the table.
  expect(consentBannerDocumentVersions).toEqual(
    Object.fromEntries(
      locales.map((locale) => [
        locale,
        {
          "privacy-policy": getLegalDocumentVersion(locale, "privacy-policy"),
          "cookie-policy": getLegalDocumentVersion(locale, "cookie-policy"),
        },
      ])
    )
  );
});

describe("getConsentBannerRevision", () => {
  const published = getConsentBannerRevision(versionsWithEdit());

  test("an edit to the privacy notice or the cookie policy in any locale gives a new revision", () => {
    for (const locale of locales) {
      for (const documentKey of ["privacy-policy", "cookie-policy"] as const) {
        expect(
          getConsentBannerRevision(versionsWithEdit({ locale, documentKey }))
        ).not.toBe(published);
      }
    }
  });

  test("an edit to any other legal document keeps the revision", () => {
    for (const locale of locales) {
      for (const documentKey of documentKeys.slice(2)) {
        expect(
          getConsentBannerRevision(versionsWithEdit({ locale, documentKey }))
        ).toBe(published);
      }
    }
  });

  test("keeps the published revision of every locale's recorded versions", () => {
    // Saved consent choices carry this revision; changing it reopens the
    // banner for every visitor.
    expect(getConsentBannerRevision()).toBe(72178894499992);
  });

  test("gives a new revision once a locale's versions are recorded", () => {
    const recordedIn =
      (recorded: readonly Locale[]) =>
      (locale: Locale, documentKey: LegalDocumentKey) =>
        recorded.includes(locale)
          ? versionsWithEdit()(locale, documentKey)
          : undefined;

    expect(getConsentBannerRevision(recordedIn(["en-US", "cs-CZ"]))).not.toBe(
      getConsentBannerRevision(recordedIn(["en-US", "cs-CZ", "de-DE"]))
    );
  });

  test("the published revision is a positive safe integer, so no cookie saved before the binding matches it", () => {
    const revision = getConsentBannerRevision();

    expect(Number.isSafeInteger(revision)).toBe(true);
    expect(revision).toBeGreaterThan(0);
    expect(getConsentBannerRevision()).toBe(revision);
  });
});
