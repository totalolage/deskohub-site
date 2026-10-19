import { test } from "@playwright/test";
import { enablePreviewAccess } from "../preview-access";
import {
  auditedLocales,
  expectAxeClean,
  openSettledPage,
} from "./accessibility-audit";
import { localFixtureSkipReason, sandboxSkipReason } from "./audit-target";
import {
  openSignIn,
  reservationForms,
  statusOutcomes,
  submitEmptyReservationForm,
  submitInvalidSignInEmail,
  withStatusOutcome,
} from "./page-states";

test.beforeEach(async ({ baseURL, context }) => {
  await enablePreviewAccess(context, baseURL);
});

for (const locale of auditedLocales) {
  for (const { family, path } of reservationForms) {
    test(`${locale} ${family} form with missing fields has no detectable accessibility violations`, async ({
      page,
    }, testInfo) => {
      test.skip(sandboxSkipReason !== undefined, sandboxSkipReason);
      await openSettledPage(page, `/${locale}${path}`);
      await submitEmptyReservationForm(page);
      await expectAxeClean(page, testInfo);
    });
  }

  test(`${locale} sign-in with an invalid email has no detectable accessibility violations`, async ({
    page,
  }, testInfo) => {
    await openSignIn(page, locale);
    await submitInvalidSignInEmail(page, locale);
    await expectAxeClean(page, testInfo);
  });

  for (const outcome of statusOutcomes) {
    test(`${locale} ${outcome} reservation status has no detectable accessibility violations`, async ({
      page,
    }, testInfo) => {
      test.skip(
        outcome !== "not_found" && localFixtureSkipReason !== undefined,
        localFixtureSkipReason
      );
      await withStatusOutcome(page, locale, outcome, () =>
        expectAxeClean(page, testInfo)
      );
    });
  }
}
