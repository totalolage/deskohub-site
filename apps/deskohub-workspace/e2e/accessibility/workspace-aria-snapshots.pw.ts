import { expect, test } from "@playwright/test";
import { enablePreviewAccess } from "../preview-access";
import { auditedLocales, openSettledPage } from "./accessibility-audit";
import { localFixtureSkipReason, sandboxSkipReason } from "./audit-target";
import {
  openSignIn,
  reservationForm,
  reservationForms,
  statusOutcomes,
  submitEmptyReservationForm,
  withStatusOutcome,
} from "./page-states";

// Browser agents act on these roles and names. The snapshot files are curated
// partial templates: landmarks, headings, controls with their names and
// states, and link targets. Dynamic values (dates, prices, times, IDs) are
// regular expressions or left out, and so is prose, so copy and price changes
// don't break them. `--update-snapshots` rewrites a file with the full
// capture, which pins today's date and every sentence; trim it back to the
// same shape before committing. Only the desktop project runs this file.

test.beforeEach(async ({ baseURL, context }) => {
  await enablePreviewAccess(context, baseURL);
});

for (const locale of auditedLocales) {
  for (const { family, path } of reservationForms) {
    test(`${locale} ${family} form default state`, async ({ page }) => {
      test.skip(sandboxSkipReason !== undefined, sandboxSkipReason);
      await openSettledPage(page, `/${locale}${path}`);
      await expect(reservationForm(page)).toMatchAriaSnapshot({
        name: `${locale}-${family}-form.aria.yml`,
      });
    });
  }

  test(`${locale} cowork form with validation errors`, async ({ page }) => {
    test.skip(sandboxSkipReason !== undefined, sandboxSkipReason);
    await openSettledPage(page, `/${locale}/reservation/cowork`);
    await submitEmptyReservationForm(page);
    await expect(reservationForm(page)).toMatchAriaSnapshot({
      name: `${locale}-cowork-form-invalid.aria.yml`,
    });
  });

  test(`${locale} sign-in card`, async ({ page }) => {
    await openSignIn(page, locale);
    await expect(page.getByRole("main")).toMatchAriaSnapshot({
      name: `${locale}-sign-in.aria.yml`,
    });
  });

  for (const outcome of statusOutcomes) {
    test(`${locale} ${outcome} reservation status`, async ({ page }) => {
      test.skip(
        outcome !== "not_found" && localFixtureSkipReason !== undefined,
        localFixtureSkipReason
      );
      await withStatusOutcome(page, locale, outcome, () =>
        expect(page.getByRole("main")).toMatchAriaSnapshot({
          name: `${locale}-status-${outcome}.aria.yml`,
        })
      );
    });
  }
}
