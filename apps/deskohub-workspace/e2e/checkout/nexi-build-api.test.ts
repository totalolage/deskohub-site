import { expect, test } from "bun:test";
import {
  formatNexiBuildFailureCodes,
  formatNexiBuildFailureLine,
  isNexiBuildApiUrl,
  listNexiBuildFailureCodes,
  parseNexiBuildFailures,
  parseNexiBuildResponses,
  summarizeNexiBuildFailureBody,
  toNexiBuildEndpoint,
} from "./nexi-build-api";

test("recognizes only Nexi hosted-field API calls", () => {
  expect(
    isNexiBuildApiUrl(new URL("https://xpay.nexigroup.com/fe/build/text/"))
  ).toBe(true);
  expect(
    isNexiBuildApiUrl(new URL("https://xpay.nexigroup.com/fe/v2/build/state"))
  ).toBe(true);
  expect(
    isNexiBuildApiUrl(new URL("https://xpay.nexigroup.com/hpp/nexi/error"))
  ).toBe(false);
  expect(
    isNexiBuildApiUrl(new URL("https://nexigroup.com.example/fe/build/text/"))
  ).toBe(false);
});

test("classifies hosted-field endpoints", () => {
  const endpoint = (path: string) =>
    toNexiBuildEndpoint(new URL(`https://xpay.nexigroup.com${path}`));
  expect(endpoint("/fe/build/text/")).toBe("card-data");
  expect(endpoint("/fe/build/text/BROWSER_DATA")).toBe("browser-data");
  expect(endpoint("/fe/build/validateAndPay")).toBe("validate-and-pay");
  expect(endpoint("/fe/build/check_gdi_result")).toBe("gdi-result");
  expect(endpoint("/fe/build/finalize_payment")).toBe("finalize-payment");
  expect(endpoint("/fe/build/unknown")).toBe("other");
});

test("keeps only provider codes from a failed hosted-field response body", () => {
  const summary = summarizeNexiBuildFailureBody(
    JSON.stringify({
      cardholderName: "Synthetic Customer",
      errors: [
        { code: "GW0027", description: "free text" },
        { code: "not a code" },
      ],
      fieldStatus: [
        { event: "FIELD_INVALID", id: "CARD_NUMBER", value: "secret" },
        { event: "FIELD_VALID", id: "custom-field" },
      ],
      state: "CARD_DATA",
      workflowState: "free text",
    })
  );

  expect(summary).toEqual({
    errors: [{ code: "GW0027" }],
    fieldStatus: [
      { event: "FIELD_INVALID", id: "CARD_NUMBER" },
      { event: "FIELD_VALID", id: "[other]" },
    ],
    state: "CARD_DATA",
  });
  expect(summary && listNexiBuildFailureCodes(summary)).toEqual([
    "GW0027",
    "CARD_DATA",
  ]);
  expect(summarizeNexiBuildFailureBody("<html>error</html>")).toBeUndefined();
  expect(
    summarizeNexiBuildFailureBody(JSON.stringify({ message: "free text" }))
  ).toBeUndefined();
});

test("round-trips code-only failure lines through the session network log", () => {
  const line = formatNexiBuildFailureLine({
    codes: ["GW0027"],
    endpoint: "card-data",
    status: 400,
  });
  expect(line).toBe("nexi-build-failure 400 card-data GW0027");

  const networkLog = [
    "POST https://xpay.nexigroup.com/fe/build/text/",
    "400 POST https://xpay.nexigroup.com/fe/build/text/",
    line,
    "nexi-build-failure 500 validate-and-pay GW0001,PAYMENT_FAILED",
    "nexi-build-failure 400 unknown-endpoint GW0027",
    "nexi-build-failure 400 card-data lowercase",
  ].join("\n");

  const failures = parseNexiBuildFailures(networkLog);
  expect(failures).toEqual([
    { codes: ["GW0027"], endpoint: "card-data", status: 400 },
    {
      codes: ["GW0001", "PAYMENT_FAILED"],
      endpoint: "validate-and-pay",
      status: 500,
    },
  ]);
  expect(formatNexiBuildFailureCodes(failures)).toBe(
    "card-data HTTP 400 GW0027; validate-and-pay HTTP 500 GW0001,PAYMENT_FAILED"
  );
  expect(formatNexiBuildFailureCodes([])).toBe("none observed");
  // The code-only line never counts as a response of its own.
  expect(parseNexiBuildResponses(networkLog)).toEqual([
    { endpoint: "card-data", method: "POST", status: 400 },
  ]);
});
