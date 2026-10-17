import { describe, expect, test } from "bun:test";
import {
  formatProviderCode,
  getProviderValueLabel,
} from "./payment-presentation";

describe("payment presentation", () => {
  test("names known Nexi codes in the route locale", () => {
    expect(getProviderValueLabel("DENIED_BY_RISK", "cs-CZ")).toBe(
      "Odmítnuto kontrolou rizik"
    );
    expect(getProviderValueLabel("AUTHORIZATION", "cs-CZ")).toBe("Autorizace");
    expect(getProviderValueLabel("executed", "cs-CZ")).toBe("Provedeno");
    expect(getProviderValueLabel("BACKOFFICE", "en-US")).toBe("Back office");
  });

  test("keeps an unknown Nexi code in English words", () => {
    expect(getProviderValueLabel("INCREMENTAL_AUTHORIZATION", "cs-CZ")).toBe(
      "Incremental Authorization"
    );
  });

  test("keeps the API's English wording for every code", () => {
    expect(formatProviderCode("DENIED_BY_RISK")).toBe("Denied By Risk");
  });
});
