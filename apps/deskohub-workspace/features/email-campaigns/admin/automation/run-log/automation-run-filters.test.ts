import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import {
  type AutomationRunFilters,
  automationRunFilterParams,
  hasAutomationRunFilters,
  parseAutomationRunFilters,
} from "./automation-run-filters";

const validSearchParams = {
  state: "active",
  outcome: "sent",
  skipReason: "missing-email",
  step: "pause",
  version: "2",
  customer: "dotypos-customer-1",
  cursor: "cursor-1",
};

const emptyFilters = (): AutomationRunFilters => ({
  state: Option.none(),
  outcome: Option.none(),
  skipReason: Option.none(),
  stepId: Option.none(),
  versionNumber: Option.none(),
  customerId: Option.none(),
  cursor: Option.none(),
});

describe("parseAutomationRunFilters", () => {
  test("parses valid values for every parameter and trims them", () => {
    expect(
      parseAutomationRunFilters({
        state: " active ",
        outcome: " sent ",
        skipReason: " missing-email ",
        step: " pause ",
        version: " 2 ",
        customer: " dotypos-customer-1 ",
        cursor: " cursor-1 ",
      })
    ).toEqual({
      state: Option.some("active"),
      outcome: Option.some("sent"),
      skipReason: Option.some("missing-email"),
      stepId: Option.some("pause"),
      versionNumber: Option.some(2),
      customerId: Option.some("dotypos-customer-1"),
      cursor: Option.some("cursor-1"),
    });
  });

  test("uses the first value of a repeated parameter", () => {
    expect(
      parseAutomationRunFilters({ state: [" active ", "ended"] }).state
    ).toEqual(Option.some("active"));
  });

  test("drops empty and whitespace-only values", () => {
    expect(
      parseAutomationRunFilters({
        state: " ",
        outcome: "\t",
        skipReason: "\n",
        step: "  ",
        version: " ",
        customer: "\t",
        cursor: "  ",
      })
    ).toEqual(emptyFilters());
  });

  test("drops values outside the filter schemas", () => {
    const filters = parseAutomationRunFilters({
      state: "unknown",
      outcome: "unknown",
      skipReason: "unknown",
      step: "Bad Step",
      version: "0",
    });

    expect(filters.state).toEqual(Option.none());
    expect(filters.outcome).toEqual(Option.none());
    expect(filters.skipReason).toEqual(Option.none());
    expect(filters.stepId).toEqual(Option.none());
    expect(filters.versionNumber).toEqual(Option.none());
    for (const version of ["abc", "1.5"]) {
      expect(parseAutomationRunFilters({ version }).versionNumber).toEqual(
        Option.none()
      );
    }
  });
});

describe("automationRunFilterParams", () => {
  test("round-trips filters through their URL parameter names", () => {
    const filters = parseAutomationRunFilters(validSearchParams);
    const params = automationRunFilterParams(filters);

    expect(params).toEqual(validSearchParams);
    expect(params).not.toHaveProperty("stepId");
    expect(params).not.toHaveProperty("versionNumber");
    expect(params).not.toHaveProperty("customerId");
    expect(parseAutomationRunFilters(params)).toEqual(filters);
  });

  test("serializes absent filters as undefined", () => {
    expect(
      automationRunFilterParams({
        ...emptyFilters(),
        state: Option.some("active"),
      })
    ).toStrictEqual({
      state: "active",
      outcome: undefined,
      skipReason: undefined,
      step: undefined,
      version: undefined,
      customer: undefined,
      cursor: undefined,
    });
  });
});

describe("hasAutomationRunFilters", () => {
  test("ignores an empty filter set and a cursor by itself", () => {
    const filters = parseAutomationRunFilters(validSearchParams);
    const empty = emptyFilters();

    expect(hasAutomationRunFilters(empty)).toBe(false);
    expect(hasAutomationRunFilters({ ...empty, cursor: filters.cursor })).toBe(
      false
    );
  });

  test("recognizes each individual filter", () => {
    const filters = parseAutomationRunFilters(validSearchParams);
    const empty = emptyFilters();

    for (const singleFilter of [
      { ...empty, state: filters.state },
      { ...empty, outcome: filters.outcome },
      { ...empty, skipReason: filters.skipReason },
      { ...empty, stepId: filters.stepId },
      { ...empty, versionNumber: filters.versionNumber },
      { ...empty, customerId: filters.customerId },
    ]) {
      expect(hasAutomationRunFilters(singleFilter)).toBe(true);
    }
  });
});
