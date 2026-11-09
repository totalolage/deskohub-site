import { Option, Schema } from "effect";
import { type Money, type MoneyUnit, moneyWithValue } from "./money";

const czkCurrency = {
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

export const defaultWorkspaceCurrencyCode = czkCurrency.code;

export const findWorkspaceCurrencyDefinition = (code: string) =>
  workspaceCurrencyDefinitions.find((currency) => currency.code === code);

const toMoneyUnit = (currency: {
  readonly code: WorkspaceCurrencyCode;
  readonly exponent: number;
}): MoneyUnit => ({ currency: currency.code, exponent: currency.exponent });

/** The unit amounts in a catalog currency carry; none for other codes. */
export const unitOf = (currencyCode: string): Option.Option<MoneyUnit> =>
  Option.fromUndefinedOr(findWorkspaceCurrencyDefinition(currencyCode)).pipe(
    Option.map(toMoneyUnit)
  );

/** `value` minor units of Czech koruna. */
export const currencyCZK = (value: number): Money =>
  moneyWithValue(value, toMoneyUnit(czkCurrency));
