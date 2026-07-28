import { describe, expect, test } from "bun:test";
import {
  defaultWorkspaceCurrency,
  findWorkspaceCurrencyDefinition,
  workspaceCurrencyDefinitions,
} from "./currencies";

describe("Workspace currency definitions", () => {
  test("use unique ISO-style codes and valid exponents", () => {
    expect(
      new Set(workspaceCurrencyDefinitions.map(({ code }) => code)).size
    ).toBe(workspaceCurrencyDefinitions.length);

    for (const currency of workspaceCurrencyDefinitions) {
      expect(currency.code).toMatch(/^[A-Z]{3}$/);
      expect(Number.isInteger(currency.exponent)).toBe(true);
      expect(currency.exponent).toBeGreaterThanOrEqual(0);
    }
  });

  test("exposes the default and finds only catalog currencies", () => {
    expect(defaultWorkspaceCurrency.code).toBe("CZK");
    expect(findWorkspaceCurrencyDefinition("EUR")).toEqual({
      code: "EUR",
      exponent: 2,
      name: "Euro",
    });
    expect(findWorkspaceCurrencyDefinition("USD")).toBeUndefined();
  });
});
