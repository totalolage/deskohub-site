import { expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { formatDiscountAdjustment } from "@/features/checkout/format-discount-adjustment";
import {
  currencyCZK,
  formatWorkspaceMoney,
} from "@/features/checkout/workspace-money";
import { m } from "@/features/i18n";
import type { CheckoutData } from "../types";
import {
  getAppliedZeroTotalPaySummaryCondition,
  getDiscountListedOnceCondition,
  getSelectedDurationZeroPriceCondition,
} from "./reservation-links";

const enData = {
  locale: "en-US",
  meetingRoom: { duration: { unit: "hour", amount: 1 } },
} as CheckoutData;
const csData = {
  locale: "cs-CZ",
  meetingRoom: { duration: { unit: "hour", amount: 1 } },
} as CheckoutData;

const zeroText = (data: CheckoutData) =>
  formatWorkspaceMoney(currencyCZK(0), data.locale);

const runPredicate = async (script: string): Promise<boolean> => {
  const run = new Function(
    "document",
    "HTMLSpanElement",
    "HTMLInputElement",
    "HTMLFormElement",
    `return (${script})`
  );
  return (
    run(document, HTMLSpanElement, HTMLInputElement, HTMLFormElement) === true
  );
};

const withBody = async (html: string, script: string) => {
  await GlobalRegistrator.register({
    url: "https://workspace.example.test/en-US/checkout/pay",
  });
  document.body.innerHTML = html;
  try {
    return await runPredicate(script);
  } finally {
    await GlobalRegistrator.unregister();
  }
};

test("exact-total predicate requires exactly one zero total row per locale", async () => {
  const totalRow = (label: string, amount: string) => `
    <div><span>${label}</span><span>${amount}</span></div>`;

  // Exact en-US zero total passes.
  expect(
    await withBody(
      totalRow("Total to pay", zeroText(enData)),
      getAppliedZeroTotalPaySummaryCondition(enData)
    )
  ).toBe(false); // applied message missing, total alone is not enough

  // Exact cs-CZ total with applied message present passes.
  const csScript = getAppliedZeroTotalPaySummaryCondition(csData);
  const csApplied = m.checkoutDiscountCodeApplied(
    { discount: "100 %" },
    { locale: "cs-CZ" }
  );
  expect(
    await withBody(
      `${totalRow("Celkem k platbě", zeroText(csData))}<p>${csApplied}</p>`,
      csScript
    )
  ).toBe(true);

  // A positive total never matches the zero expectation.
  expect(
    await withBody(
      `${totalRow("Total to pay", "100 Kč")}<p>Promotion applied: 100% off 🎉</p>`,
      getAppliedZeroTotalPaySummaryCondition(enData)
    )
  ).toBe(false);

  // A zero amount on another line with a nonzero total fails.
  expect(
    await withBody(
      `${totalRow("E2E 100% discount", "0 Kč")}${totalRow("Total to pay", "350 Kč")}`,
      getAppliedZeroTotalPaySummaryCondition(enData)
    )
  ).toBe(false);

  // A duplicated total row fails the exactly-one requirement.
  expect(
    await withBody(
      `${totalRow("Total to pay", zeroText(enData))}${totalRow("Total to pay", zeroText(enData))}`,
      getAppliedZeroTotalPaySummaryCondition(enData)
    )
  ).toBe(false);
});

const tooltip = (items: readonly string[]) => `
  <button data-checkout-discount-details aria-describedby="discount-details">details</button>
  <div id="discount-details"><ul>${items
    .map((item) => `<li>${item}</li>`)
    .join("")}</ul></div>`;

test("discount-listed-once predicate counts the fixture label exactly once", async () => {
  const script = getDiscountListedOnceCondition({
    adjustmentText: "100%",
    label: "e2e 100% discount",
  });

  // Exactly one matching discount passes alongside an unrelated discount.
  expect(
    await withBody(
      tooltip(["E2E Calendar sale 20%", "E2E 100% discount 100%"]),
      script
    )
  ).toBe(true);

  // A duplicated fixture discount fails.
  expect(
    await withBody(
      tooltip(["E2E 100% discount 100%", "E2E 100% discount 100%"]),
      script
    )
  ).toBe(false);

  // A missing fixture discount fails.
  expect(await withBody(tooltip(["E2E Calendar sale 20%"]), script)).toBe(
    false
  );

  // A missing tooltip fails closed.
  expect(
    await withBody("<ul><li>E2E 100% discount 100%</li></ul>", script)
  ).toBe(false);
});

test("czech discount-listed-once predicate tolerates the localized NBSP percent", async () => {
  // Use the actual formatter output: cs-CZ emits "100\u00a0%" with a
  // non-breaking space, which must match after normalization.
  const adjustmentText = formatDiscountAdjustment(
    { kind: "percentage", basisPoints: 10_000 },
    "cs-CZ"
  );
  expect(adjustmentText).toMatch(/^100[\s\u00a0]?%$/);
  const script = getDiscountListedOnceCondition({
    adjustmentText,
    label: "E2E sleva 100 %",
  });
  const item = (adjustment: string) => `E2E sleva 100 % ${adjustment}`;

  // Exactly one matching Czech discount passes alongside an unrelated one.
  expect(
    await withBody(
      tooltip(["E2E kalendářová sleva 20%", item(adjustmentText)]),
      script
    )
  ).toBe(true);

  // A duplicated Czech discount fails.
  expect(
    await withBody(
      tooltip([item(adjustmentText), item(adjustmentText)]),
      script
    )
  ).toBe(false);
});

test("selected-duration predicate demands the exact discounted zero price", async () => {
  const option = (discounted: string, visible: string, original?: string) => `
    <div data-reservation-type-option="hour:1">
      ${original ? `<del>${original}</del>` : ""}
      <span class="sr-only">Discounted price: ${discounted}</span>
      <span class="text-aquamarine-ink"><span aria-hidden="true">${visible}</span></span>
    </div>`;

  expect(
    await withBody(
      option(zeroText(enData), zeroText(enData), "CZK 350"),
      getSelectedDurationZeroPriceCondition(enData)
    )
  ).toBe(true);

  // A positive current amount fails even with a zero label elsewhere.
  expect(
    await withBody(
      option("CZK 350", "CZK 350"),
      getSelectedDurationZeroPriceCondition(enData)
    )
  ).toBe(false);

  // The cs-CZ semantic text must match exactly.
  const csOption = `
    <div data-reservation-type-option="hour:1">
      <del>350 Kč</del>
      <span class="sr-only">${m.checkoutSummaryDiscountedPrice(
        { price: "0 Kč" },
        { locale: "cs-CZ" }
      )}</span>
      <span class="text-aquamarine-ink"><span aria-hidden="true">0 Kč</span></span>
    </div>`;
  expect(
    await withBody(csOption, getSelectedDurationZeroPriceCondition(csData))
  ).toBe(true);
});
