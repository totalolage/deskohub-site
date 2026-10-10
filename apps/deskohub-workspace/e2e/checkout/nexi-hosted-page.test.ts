import { expect, test } from "bun:test";
import {
  isWorkspaceE2EDiagnosticCode,
  nexiHostedPaymentPageStates,
  nexiHostedPaymentSteps,
  toNexiHostedPaymentDiagnosticCode,
} from "../errors";
import { parseNexiBuildResponses } from "./nexi-build-api";
import {
  classifyNexiHostedPage,
  countNexiCardDataRejections,
  findNexiCardField,
  findNexiControl,
  formatNexiBuildFailures,
  isTerminalNexiHostedPageState,
  type NexiHostedPageObservation,
  parseNexiSnapshot,
  toNexiHostedPageStateCode,
} from "./nexi-hosted-page";

// Shape of the Nexi XPay sandbox card page as Playwright reports it from the
// main document: every hosted field lives in its own iframe.
const cardFormSnapshot = ({
  continueDisabled = false,
  fieldsDisabled = false,
}: {
  readonly continueDisabled?: boolean;
  readonly fieldsDisabled?: boolean;
} = {}) => {
  const disabled = fieldsDisabled ? " [disabled]" : "";
  return [
    "- main [ref=e3]:",
    "  - generic [ref=e11]:",
    '    - button "Nexi Logo" [ref=e13]:',
    '      - img "Nexi Logo" [ref=e14]',
    '    - button "Open" [ref=e22]:',
    '  - heading "XPAY | Checkout" [level=1] [ref=e25]',
    "  - generic [ref=e35]:",
    '    - heading "Enter your card information" [level=2] [ref=e36]',
    "    - generic [ref=e38]:",
    "      - text: Card number",
    "      - iframe [ref=e39]:",
    "        - generic [ref=f1e5]:",
    '          - textbox "Card number" [ref=f1e6]:',
    "            - /placeholder: Enter the card number",
    '      - img "VISA" [ref=e76]',
    "    - generic [ref=e41]:",
    "      - iframe [ref=e42]:",
    "        - generic [ref=f2e5]:",
    `          - textbox "Expiration date"${disabled} [ref=f2e6]:`,
    "    - generic [ref=e44]:",
    '      - button "info" [ref=e48] [cursor=pointer]:',
    "      - iframe [ref=e53]:",
    "        - generic [ref=f3e5]:",
    `          - textbox "CVV"${disabled} [ref=f3e6]:`,
    "    - generic [ref=e55]:",
    "      - iframe [ref=e56]:",
    "        - generic [ref=f4e5]:",
    `          - textbox "First Name"${disabled} [ref=f4e6]:`,
    "    - generic [ref=e58]:",
    "      - iframe [ref=e59]:",
    "        - generic [ref=f5e5]:",
    `          - textbox "Email"${disabled} [ref=f5e6]:`,
    `    - button "Continue"${continueDisabled ? " [disabled]" : ""} [active] [ref=e77] [cursor=pointer]:`,
    "      - generic [ref=e79]: Continue",
    '  - generic "Abort payment" [ref=e62] [cursor=pointer]:',
  ].join("\n");
};

const observe = (
  overrides: Partial<NexiHostedPageObservation> = {}
): NexiHostedPageObservation => ({
  cardDataRejections: 0,
  isReturnUrl: false,
  responses: [],
  snapshot: cardFormSnapshot(),
  url: "https://xpaysandbox.nexigroup.com/hpp/nexi/session/card",
  ...overrides,
});

test("locates each hosted card field and the iframe that owns it", () => {
  const nodes = parseNexiSnapshot(cardFormSnapshot({ fieldsDisabled: true }));

  expect(findNexiCardField(nodes, "card_number")).toEqual({
    enabled: true,
    frameRef: "@e39",
    ref: "@f1e6",
  });
  expect(findNexiCardField(nodes, "expiration_date")).toEqual({
    enabled: false,
    frameRef: "@e42",
    ref: "@f2e6",
  });
  expect(findNexiCardField(nodes, "cardholder_email")).toEqual({
    enabled: false,
    frameRef: "@e59",
    ref: "@f5e6",
  });
  // A sibling outside an iframe is not attributed to the preceding iframe.
  expect(nodes.find((node) => node.ref === "@e76")?.frameRef).toBeUndefined();
});

test("matches Nexi controls by role and accessible name, not substrings", () => {
  const nodes = parseNexiSnapshot(
    [
      '- button "Abort payment" [ref=e1]',
      '- button "Click to Pay" [ref=e2]',
      '- button "PayPal" [ref=e3]',
      "- iframe [ref=e4]:",
      '  - button "Pay" [ref=f1e1]',
      '- link "Pay" [ref=e5]',
      '- button "Pay" [disabled] [ref=e6]',
      '- button "PAY €208.80" [ref=e7]',
      '- button "Pay" [ref=e8]',
    ].join("\n")
  );

  expect(findNexiControl(nodes, "pay")).toEqual({ enabled: true, ref: "@e8" });
  expect(
    findNexiControl(parseNexiSnapshot('- button "PAY €208.80" [ref=e7]'), "pay")
  ).toEqual({ enabled: true, ref: "@e7" });
  expect(
    findNexiControl(
      parseNexiSnapshot(
        [
          '- button "Abort payment" [ref=e1]',
          '- button "PayPal" [ref=e3]',
        ].join("\n")
      ),
      "pay"
    )
  ).toBeUndefined();
  expect(
    findNexiControl(
      parseNexiSnapshot('- button "TORNA AL NEGOZIO" [ref=e9]'),
      "return"
    )
  ).toEqual({ enabled: true, ref: "@e9" });
});

test("keeps only Nexi hosted-field API statuses from the session log", () => {
  const responses = parseNexiBuildResponses(
    [
      "POST https://xpaysandbox.nexigroup.com/fe/build/text/",
      "200 GET https://xpaysandbox.nexigroup.com/fe/build/field_settings/CARD_NUMBER?lang=0",
      "200 POST https://xpaysandbox.nexigroup.com/fe/build/text/BROWSER_DATA",
      "400 POST https://xpaysandbox.nexigroup.com/fe/build/text/",
      "500 GET https://xpaysandbox.nexigroup.com/fe/v2/build/state",
      "500 GET https://xpaysandbox.nexigroup.com/fe/build/validateAndPay",
      "200 GET https://xpaysandbox.nexigroup.com/fe/build/check_gdi_result",
      "400 POST https://deskohub-workspace.example.vercel.app/fe/build/text/",
      "404 GET https://xpaysandbox.nexigroup.com/hpp/static/missing.js",
      "200 GET https://xpaysandbox.nexigroup.com/fe/build/text/ failed: net::ERR_ABORTED",
    ].join("\n")
  );

  expect(responses).toEqual([
    { endpoint: "other", method: "GET", status: 200 },
    { endpoint: "browser-data", method: "POST", status: 200 },
    { endpoint: "card-data", method: "POST", status: 400 },
    { endpoint: "state", method: "GET", status: 500 },
    { endpoint: "validate-and-pay", method: "GET", status: 500 },
    { endpoint: "gdi-result", method: "GET", status: 200 },
  ]);
  expect(countNexiCardDataRejections(responses)).toBe(1);
  expect(formatNexiBuildFailures(responses)).toBe(
    "Nexi build API failures: card-data HTTP 400, state HTTP 500, validate-and-pay HTTP 500"
  );
  expect(formatNexiBuildFailures([])).toBe(
    "Nexi build API failures: none observed"
  );
});

test("counts only failed card-data saves as rejections", () => {
  expect(
    countNexiCardDataRejections(
      parseNexiBuildResponses(
        [
          "500 POST https://xpaysandbox.nexigroup.com/fe/build/text/",
          "400 GET https://xpaysandbox.nexigroup.com/fe/build/text/",
          "200 POST https://xpaysandbox.nexigroup.com/fe/build/text/",
          "400 POST https://example.com/fe/build/text/",
        ].join("\n")
      )
    )
  ).toBe(1);
});

test("classifies the card form, including the inert form after a rejected save", () => {
  expect(classifyNexiHostedPage(observe())).toEqual({
    kind: "card-entry",
    ready: true,
  });
  expect(
    classifyNexiHostedPage(
      observe({ snapshot: cardFormSnapshot({ fieldsDisabled: true }) })
    )
  ).toEqual({ kind: "card-entry", ready: false });

  const rejected = classifyNexiHostedPage(
    observe({
      cardDataRejections: 1,
      responses: [{ endpoint: "card-data", method: "POST", status: 400 }],
      snapshot: cardFormSnapshot({ fieldsDisabled: true }),
    })
  );
  expect(rejected).toEqual({ kind: "card-submission-rejected" });
  expect(isTerminalNexiHostedPageState(rejected)).toBe(true);
});

test("classifies Nexi provider error pages before any control", () => {
  const errorPage = [
    "- main [ref=e3]:",
    '  - heading "Payment error" [level=1] [ref=e86]',
    '  - button "Back to the shop" [ref=e94] [cursor=pointer]:',
  ].join("\n");

  expect(
    classifyNexiHostedPage(
      observe({
        snapshot: errorPage,
        url: "https://xpaysandbox.nexigroup.com/hpp/nexi/error?operationId=x",
      })
    )
  ).toEqual({ kind: "provider-error-page" });
  expect(
    classifyNexiHostedPage(
      observe({ snapshot: errorPage, url: "https://example.test/other" })
    )
  ).toEqual({ kind: "provider-error-page" });
  expect(
    classifyNexiHostedPage(
      observe({
        snapshot: '- heading "OPS! Something went wrong" [level=1] [ref=e2]',
        url: "https://xpaysandbox.nexigroup.com/phoenix-0.0/challenge_hpp.html",
      })
    )
  ).toEqual({ kind: "provider-failure-page" });
});

test("classifies payment progress, return, and missing snapshots", () => {
  expect(
    classifyNexiHostedPage(observe({ snapshot: '- button "PAY" [ref=e7]' }))
  ).toEqual({ control: "pay", enabled: true, kind: "control" });
  expect(
    classifyNexiHostedPage(
      observe({ snapshot: '- button "Authentication successful" [ref=e43]' })
    )
  ).toEqual({ control: "challenge", enabled: true, kind: "control" });
  expect(
    classifyNexiHostedPage(
      observe({ isReturnUrl: true, snapshot: "", url: undefined })
    )
  ).toEqual({ kind: "returned" });
  expect(classifyNexiHostedPage(observe({ snapshot: "" }))).toEqual({
    kind: "snapshot-unavailable",
  });
  expect(
    classifyNexiHostedPage(
      observe({
        responses: [{ endpoint: "state", method: "GET", status: 500 }],
        snapshot: '- generic [ref=e2]: "..."',
      })
    )
  ).toEqual({ kind: "unknown", providerServerError: true });
});

test("maps every hosted page state to an allowlisted diagnostic code", () => {
  for (const step of nexiHostedPaymentSteps) {
    for (const state of nexiHostedPaymentPageStates) {
      expect(
        isWorkspaceE2EDiagnosticCode(
          toNexiHostedPaymentDiagnosticCode(step, state)
        )
      ).toBe(true);
    }
  }
  expect(toNexiHostedPageStateCode({ kind: "card-submission-rejected" })).toBe(
    "card_submission_rejected"
  );
  expect(
    toNexiHostedPageStateCode({
      control: "continue",
      enabled: false,
      kind: "control",
    })
  ).toBe("continue_disabled");
  expect(toNexiHostedPageStateCode({ kind: "returned" })).toBeUndefined();
});
