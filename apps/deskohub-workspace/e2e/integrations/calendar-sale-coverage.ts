import type { Browser } from "@playwright/test";
import { Effect } from "effect";
import { waitForAdvertisedCalendarSale } from "../cases/discounts";
import { makeCoworkCheckoutData } from "../checkout/data";
import type { WorkspaceE2EConfig } from "../config";
import { workspaceE2EError } from "../errors";
import { makePlaywrightBrowserRunner } from "../runtime";

/** Checks the furthest prepared candidate without submitting a reservation. */
export const assertE2ECalendarSaleCoverage = ({
  browser,
  candidateDates,
  config,
}: {
  readonly browser: Browser;
  readonly candidateDates: readonly string[];
  readonly config: WorkspaceE2EConfig;
}) =>
  Effect.suspend(() => {
    const lastServiceDate = candidateDates.toSorted().at(-1);
    const coverageFailure = () =>
      workspaceE2EError(
        "Calendar sale fixture coverage failed: expected E2E Calendar sale at 20% on the furthest planned candidate service date",
        { operation: "verify E2E Calendar sale coverage" }
      );
    if (!lastServiceDate) return Effect.fail(coverageFailure());
    return Effect.acquireUseRelease(
      Effect.sync(() =>
        makePlaywrightBrowserRunner(browser, { recordHar: false })
      ),
      (run) =>
        waitForAdvertisedCalendarSale({
          config,
          data: makeCoworkCheckoutData(
            config.baseUrl,
            lastServiceDate,
            "calendar-sale-fixture-coverage"
          ),
          run,
          session: "calendar-sale-fixture-coverage",
        }).pipe(Effect.mapError(coverageFailure)),
      (run) => Effect.promise(async () => run.close?.())
    );
  });
