import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { audienceAttributeCatalogue } from "@deskohub/workspace-admin-api";
import { Result, Schema } from "effect";
import type { Locale } from "@/features/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  type AudienceCondition,
  audienceFilterSchema,
} from "../../audience-filter";
import {
  type AudienceCountWording,
  audienceAttributeWording,
} from "./audience-attribute-wording";
import { newCondition } from "./audience-filter-editing";

registerWorkspaceComponentTestEnv();
// @testing-library/react must load after the happy-dom registration.
const { cleanup, render } = await import("@testing-library/react");
const { CountConditionControls } = await import(
  "./audience-condition-controls"
);

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

/** The form's lookup: each issue's message at its path below the condition. */
const formErrors = (input: AudienceCondition) => {
  const result =
    Schema.toStandardSchemaV1(audienceFilterSchema)["~standard"].validate(
      input
    );
  const issues = "issues" in result ? (result.issues ?? []) : [];
  return (field: string) =>
    issues.find(({ path }) => (path ?? []).join(".") === field)?.message;
};

const campaignEmailCountWording = (locale: Locale) =>
  audienceAttributeWording(
    "campaignEmailCount",
    locale
  ) as AudienceCountWording;

describe("CountConditionControls", () => {
  test.each([
    ["en-US", "lt", "“< 0” never matches. Use “= 0” for none."],
    [
      "en-US",
      "gte",
      "“≥ 0” always matches. Use “≥ 1” for any, or remove the condition.",
    ],
    ["cs-CZ", "lt", "„< 0“ nevyhovuje nikdy. Pro žádné použijte „= 0“."],
  ] as const)(
    "explains in %s why “%s 0” is rejected",
    (locale, operator, message) => {
      const condition = {
        ...newCondition("campaignEmailCount"),
        operator,
        value: 0,
      } as const;
      expect(
        Result.isFailure(
          Schema.decodeUnknownResult(audienceFilterSchema)(condition)
        )
      ).toBe(true);
      const view = render(
        <RouteLocaleProvider locale={locale}>
          <CountConditionControls
            entry={audienceAttributeCatalogue.campaignEmailCount}
            wording={campaignEmailCountWording(locale)}
            value={condition}
            onChange={() => undefined}
            errorAt={formErrors(condition)}
          />
        </RouteLocaleProvider>
      );
      expect(view.getByRole("alert").textContent).toBe(message);
    }
  );
});

describe("DatePeriodControl", () => {
  test.each([
    [1, "za poslední", "den"],
    [3, "za poslední", "dny"],
    [30, "za posledních", "dní"],
  ] as const)("reads “in the last %d days” in Czech", (count, lead, unit) => {
    const condition = {
      ...newCondition("campaignEmailCount"),
      params: {
        purpose: "marketing",
        period: { _tag: "Last", count, unit: "day" },
      },
    } as const;
    const view = render(
      <RouteLocaleProvider locale="cs-CZ">
        <CountConditionControls
          entry={audienceAttributeCatalogue.campaignEmailCount}
          wording={campaignEmailCountWording("cs-CZ")}
          value={condition}
          onChange={() => undefined}
          errorAt={() => undefined}
        />
      </RouteLocaleProvider>
    );
    const trigger = (name: string) =>
      view.getByRole("combobox", { name }).textContent;
    expect(trigger("Přijaté e-maily: období")).toBe(lead);
    expect(trigger("Přijaté e-maily: jednotka období")).toBe(unit);
  });
});
