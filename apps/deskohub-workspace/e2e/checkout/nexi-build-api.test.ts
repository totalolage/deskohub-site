import { expect, test } from "bun:test";
import {
  formatNexiBuildFailureCodes,
  formatNexiBuildFailureLine,
  listNexiBuildFailureCodes,
  parseNexiBuildFailures,
  parseNexiBuildResponses,
  summarizeNexiBuildFailureBody,
} from "./nexi-build-api";

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
