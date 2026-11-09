import { describe, expect, test } from "bun:test";
import { Option, Redacted } from "effect";
import { resolveDotyposCustomerSourceToken } from "./dotypos-customer-source-access.service";

const configuredToken = "synthetic-source-token-0123456789abcdef";

describe("resolveDotyposCustomerSourceToken", () => {
  test("enables the source only on production with a configured token", () => {
    const token = resolveDotyposCustomerSourceToken({
      deploymentEnvironment: "production",
      configuredToken,
    });

    expect(Option.map(token, Redacted.value)).toEqual(
      Option.some(configuredToken)
    );
  });

  test("keeps the source disabled without a token", () => {
    expect(
      resolveDotyposCustomerSourceToken({
        deploymentEnvironment: "production",
        configuredToken: undefined,
      })
    ).toEqual(Option.none());
  });

  for (const deploymentEnvironment of ["preview", "development"] as const) {
    test(`keeps the source disabled on ${deploymentEnvironment} even with a token`, () => {
      expect(
        resolveDotyposCustomerSourceToken({
          deploymentEnvironment,
          configuredToken,
        })
      ).toEqual(Option.none());
    });
  }
});
