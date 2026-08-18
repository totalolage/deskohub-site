import { Schema } from "effect";

export const czkCurrency = {
  code: "CZK",
  exponent: 2,
  name: "Czech koruna",
} as const;

const eurCurrency = {
  code: "EUR",
  exponent: 2,
  name: "Euro",
} as const;

export const workspaceCurrencyDefinitions = [czkCurrency, eurCurrency] as const;

export type WorkspaceCurrencyCode =
  (typeof workspaceCurrencyDefinitions)[number]["code"];

export const workspaceCurrencyCodeSchema = Schema.Literals(
  workspaceCurrencyDefinitions.map(({ code }) => code)
);

export const defaultWorkspaceCurrency = czkCurrency;

export const findWorkspaceCurrencyDefinition = (code: string) =>
  workspaceCurrencyDefinitions.find((currency) => currency.code === code);
