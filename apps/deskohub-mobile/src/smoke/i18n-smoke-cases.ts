import { type AppLocale, resolveAppLocale } from "../i18n/app-locale";
import { m } from "../i18n/messages";
import { assertSmoke, type SmokeCase } from "./smoke-case";

const expectValue = (actual: string, expected: string): string => {
  assertSmoke(actual === expected, `expected "${expected}", got "${actual}"`);
  return actual;
};

const smokeTotals = (locale: AppLocale, expected: string): SmokeCase => ({
  group: "i18n",
  name: `smoke_totals ${locale}`,
  run: () =>
    expectValue(
      m.smoke_totals({ passed: 3, failed: 1, total: 4 }, { locale }),
      expected
    ),
});

/** Checks that compiled messages and locale resolution run on this runtime. */
export const i18nSmokeCases: ReadonlyArray<SmokeCase> = [
  smokeTotals("en-US", "3 of 4 passed, 1 failed"),
  smokeTotals("cs-CZ", "3 z 4 prošlo, 1 selhalo"),
  {
    group: "i18n",
    name: "resolveAppLocale",
    run: () =>
      [
        expectValue(resolveAppLocale(["fr-FR", "cs"]), "cs-CZ"),
        expectValue(resolveAppLocale(["fr-FR"]), "en-US"),
      ].join(", "),
  },
];
