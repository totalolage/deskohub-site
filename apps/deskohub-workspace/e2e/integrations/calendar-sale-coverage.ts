import type { Browser } from "@playwright/test";
import { Effect } from "effect";
import { E2EBrowserSession } from "../browser-session";
import { waitForAdvertisedCalendarSale } from "../cases/discounts";
import { makeCoworkCheckoutData } from "../checkout/data";
import type { WorkspaceE2EConfig } from "../config";
import { workspaceE2EError } from "../errors";

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
    return Effect.scoped(
      Effect.gen(function* () {
        const openSession = yield* E2EBrowserSession.openOnFirstUse({
          browser,
          id: "calendar-sale-fixture-coverage",
          recordHar: false,
        });
        yield* waitForAdvertisedCalendarSale({
          config,
          data: makeCoworkCheckoutData(
            config.baseUrl,
            lastServiceDate,
            "calendar-sale-fixture-coverage"
          ),
          openSession,
        });
      })
    ).pipe(Effect.mapError(coverageFailure));
  });
