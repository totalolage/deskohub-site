export const workspaceCurrencyDefinitions = [
  {
    code: "CZK",
    exponent: 2,
    name: "Czech koruna",
  },
  {
    code: "EUR",
    exponent: 2,
    name: "Euro",
  },
] as const;

export type WorkspaceCurrencyCode =
  (typeof workspaceCurrencyDefinitions)[number]["code"];

export const defaultWorkspaceCurrency = workspaceCurrencyDefinitions[0];

export const findWorkspaceCurrencyDefinition = (code: string) =>
  workspaceCurrencyDefinitions.find((currency) => currency.code === code);
