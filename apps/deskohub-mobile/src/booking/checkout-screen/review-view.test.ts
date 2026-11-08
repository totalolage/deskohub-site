import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import type { CustomerCheckout } from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import { BookingProblem } from "../checkout/booking-problem";
import { startCheckout, step } from "../checkout/checkout-machine";
import {
  type CheckoutCommand,
  CheckoutEvent,
  type CheckoutState,
  type ReviewState,
} from "../checkout/checkout-state";
import {
  pricedLines,
  sampleLegalDocuments,
  sampleSummary,
} from "../testing/sample-booking-catalog";
import { holdSecondsLeft, reviewView, summaryView } from "./review-view";

const selection = {
  family: "cowork",
  date: "2026-11-20",
  tier: "open-space",
  coffee: true,
} as const;

const summary = sampleSummary({ lines: pricedLines(selection) });
const documents = sampleLegalDocuments("en-US", 1);
const now = Date.parse("2026-11-20T09:05:00.000Z");

const held = (overrides: Partial<CustomerCheckout> = {}): CustomerCheckout => ({
  status: "ready",
  orderId: "order-1",
  payStateToken: "token-1",
  expiresAt: "2026-11-20T09:10:00.000Z",
  summary,
  earlyPerformanceConsent: {
    required: false,
    requiredFrom: "2026-12-04T09:00:00.000Z",
  },
  ...overrides,
});

interface Run {
  readonly state: CheckoutState;
  readonly commands: ReadonlyArray<CheckoutCommand>;
}

const run = (state: CheckoutState, ...events: ReadonlyArray<CheckoutEvent>) =>
  events.reduce<Run>(
    (previous, event) => {
      const next = step(previous.state, event);
      return {
        state: next.state,
        commands: [...previous.commands, ...next.commands],
      };
    },
    { state, commands: [] }
  );

const operationOf = (result: Run, tag: CheckoutCommand["_tag"]) => {
  const command = result.commands.findLast((sent) => sent._tag === tag);
  if (command === undefined || !("operationId" in command)) {
    throw new Error(`no ${tag} command`);
  }
  return command.operationId;
};

const asReview = (state: CheckoutState): ReviewState => {
  if (state._tag !== "Review") throw new Error(`not in Review: ${state._tag}`);
  return state;
};

const start = startCheckout({
  checkoutSessionId: "session-1",
  locale: "en-US",
  selection,
  advertisedPriceToken: "advertised-1",
  rememberedReferralCode: Option.none(),
});

/** A held checkout in Review, legal documents loaded unless told otherwise. */
const reviewWith = (
  checkout: CustomerCheckout,
  { loadLegal = true }: { readonly loadLegal?: boolean } = {}
): Run => {
  const continued = run(
    start,
    CheckoutEvent.Continue({
      checkoutAttemptId: "attempt-1",
      details: {
        bookingFor: "self",
        contact: {
          name: "Synthetic Booker",
          email: testEmailAddress("booker"),
          phone: "+420700000000",
        },
        billing: { purpose: "personal", invoice: "none" },
      },
    })
  );
  const created = run(
    continued.state,
    CheckoutEvent.CheckoutCreated({
      operationId: operationOf(continued, "CreateCheckout"),
      start: checkout,
    })
  );
  const all = {
    state: created.state,
    commands: [...continued.commands, ...created.commands],
  };
  if (!loadLegal) return all;
  const loaded = run(
    all.state,
    CheckoutEvent.LegalDocumentsLoaded({
      operationId: operationOf(all, "LoadLegalDocuments"),
      documents,
    })
  );
  return {
    state: loaded.state,
    commands: [...all.commands, ...loaded.commands],
  };
};

describe("summaryView", () => {
  test("lists every line but the final total line, then the total", () => {
    const view = summaryView(
      {
        ...summary,
        sections: [
          ...summary.sections,
          {
            key: "total",
            items: [{ key: "total:final", amount: summary.total }],
            total: summary.total,
          },
        ],
      },
      Option.none()
    );
    expect(view.lines.map((line) => line.key)).toEqual(
      pricedLines(selection).map((line) => line.key)
    );
    expect(view.total).toEqual(summary.total);
    expect(view.lines.every((line) => !line.changed)).toBe(true);
    expect(view.totalChanged).toBe(false);
  });

  test("marks only the changed items; a changed total section marks the total", () => {
    const [first, second] = pricedLines(selection);
    const byItem = summaryView(
      summary,
      Option.some({ sectionKeys: [], itemKeys: [first?.key ?? ""] })
    );
    expect(byItem.lines.map((line) => line.changed)).toEqual([true, false]);
    expect(byItem.totalChanged).toBe(false);
    const bySection = summaryView(
      summary,
      Option.some({ sectionKeys: ["order", "total"], itemKeys: [] })
    );
    expect(bySection.lines.map((line) => line.changed)).toEqual([false, false]);
    expect(bySection.totalChanged).toBe(true);
    expect(second?.key).toBe("addon:coffee");
    expect(bySection.lines[1]?.kind).toEqual({ _tag: "Coffee" });
  });

  test("carries the office line's days, seats and parts, and the discounts", () => {
    const office = sampleSummary({
      lines: pricedLines({
        family: "office",
        date: "2026-11-20",
        endDate: "2026-11-22",
        seats: 2,
      }),
      discountShare: 0.15,
      discountLabel: "Referral",
    });
    const [line] = summaryView(office, Option.none()).lines;
    expect(line?.kind).toEqual({ _tag: "Product", product: "office" });
    expect(
      Option.map(line?.office ?? Option.none(), (o) => [o.dayCount, o.seats])
    ).toEqual(Option.some([3, 2]));
    expect(Option.isSome(line?.originalAmount ?? Option.none())).toBe(true);
    expect(line?.discounts.length).toBe(1);
  });
});

describe("reviewView", () => {
  test("a price review shows the banner, marks the lines and disables Pay until accepted", () => {
    const changedKeys = { sectionKeys: [], itemKeys: ["addon:coffee"] };
    const reviewing = reviewWith(
      held({ status: "price_review", priceReview: { changedKeys } })
    );
    const ticked = run(
      reviewing.state,
      CheckoutEvent.ToggleConsent({ accepted: true })
    );
    const before = reviewView(asReview(ticked.state), now);
    expect(before.priceReview).toBe(true);
    expect(before.summary.lines.map((line) => line.changed)).toEqual([
      false,
      true,
    ]);
    expect(before.canPay).toBe(false);

    const accepting = run(ticked.state, CheckoutEvent.AcceptPrice());
    const pending = reviewView(asReview(accepting.state), now);
    expect(pending.acceptingPrice).toBe(true);
    expect(pending.code.editable).toBe(false);
    expect(pending.consent.disabled).toBe(true);

    const accepted = run(
      accepting.state,
      CheckoutEvent.PriceAccepted({
        operationId: operationOf(accepting, "AcceptPriceChange"),
        checkout: held({ payStateToken: "token-2" }),
      })
    );
    const after = reviewView(asReview(accepted.state), now);
    expect(after.priceReview).toBe(false);
    expect(after.summary.lines.every((line) => !line.changed)).toBe(true);
    expect(after.canPay).toBe(after.consent.checked);
  });

  test("Pay needs the loaded documents ticked, and holds still while submitting", () => {
    const loading = reviewWith(held(), { loadLegal: false });
    const whileLoading = reviewView(asReview(loading.state), now);
    expect(whileLoading.consent.legal._tag).toBe("Loading");
    expect(whileLoading.consent.disabled).toBe(true);
    expect(whileLoading.canPay).toBe(false);

    const loaded = reviewWith(held());
    expect(reviewView(asReview(loaded.state), now).canPay).toBe(false);
    const ticked = run(
      loaded.state,
      CheckoutEvent.ToggleConsent({ accepted: true })
    );
    expect(reviewView(asReview(ticked.state), now).canPay).toBe(true);

    const paying = run(ticked.state, CheckoutEvent.Pay());
    const submitting = reviewView(asReview(paying.state), now);
    expect(submitting.submitting).toBe(true);
    expect(submitting.canPay).toBe(false);
    expect(submitting.code.editable).toBe(false);
  });

  test("the checkbox asks for early performance when the checkout requires it", () => {
    const loaded = reviewWith(
      held({
        earlyPerformanceConsent: {
          required: true,
          requiredFrom: "2026-12-04T09:00:00.000Z",
        },
      })
    );
    expect(
      reviewView(asReview(loaded.state), now).consent.earlyPerformance
    ).toBe(true);
  });

  test("code: applying, applied, and an unavailable code stays retryable", () => {
    const loaded = reviewWith(held());
    const typed = run(
      loaded.state,
      CheckoutEvent.CodeChanged({ input: " SAVE10 " })
    );
    expect(reviewView(asReview(typed.state), now).code.canApply).toBe(true);

    const applying = run(typed.state, CheckoutEvent.ApplyCode());
    const pending = reviewView(asReview(applying.state), now);
    expect(pending.code.message._tag).toBe("Applying");
    expect(pending.busy).toBe(true);
    expect(pending.code.canApply).toBe(false);
    expect(pending.consent.disabled).toBe(true);

    const operationId = operationOf(applying, "ApplyDiscountCode");
    const unavailable = run(
      applying.state,
      CheckoutEvent.CommandFailed({
        operationId,
        problem: BookingProblem.CodeRejected({
          reason: "unavailable",
          replacement: Option.none(),
        }),
      })
    );
    const retryable = reviewView(asReview(unavailable.state), now);
    expect(retryable.code.message._tag).toBe("Retryable");
    expect(retryable.code.canApply).toBe(true);
    expect(retryable.code.input).toBe(" SAVE10 ");

    const applied = run(
      applying.state,
      CheckoutEvent.CodeApplied({
        operationId,
        result: {
          ...held({ payStateToken: "token-2" }),
          discountCode: "applied",
        },
      })
    );
    expect(reviewView(asReview(applied.state), now).code.message).toEqual({
      _tag: "Applied",
      outcome: "applied",
    });
  });

  test("an ineligible code is rejected with its reason", () => {
    const typed = run(
      reviewWith(held()).state,
      CheckoutEvent.CodeChanged({ input: "OLD" })
    );
    const applying = run(typed.state, CheckoutEvent.ApplyCode());
    const rejected = run(
      applying.state,
      CheckoutEvent.CommandFailed({
        operationId: operationOf(applying, "ApplyDiscountCode"),
        problem: BookingProblem.CodeRejected({
          reason: "ineligible",
          replacement: Option.none(),
        }),
      })
    );
    expect(reviewView(asReview(rejected.state), now).code.message).toEqual({
      _tag: "Rejected",
      reason: "ineligible",
    });
  });
});

test("reviewView counts the hold down from the flow clock's tick", () => {
  const loaded = reviewWith(held());
  expect(reviewView(asReview(loaded.state), now).holdSecondsLeft).toBe(300);
  expect(reviewView(asReview(loaded.state), now).busy).toBe(false);
});

describe("holdSecondsLeft", () => {
  test("counts whole seconds down to zero, never below", () => {
    const expiresAt = Date.parse("2026-11-20T09:10:00.000Z");
    expect(holdSecondsLeft(expiresAt, expiresAt - 90_500)).toBe(91);
    expect(holdSecondsLeft(expiresAt, expiresAt)).toBe(0);
    expect(holdSecondsLeft(expiresAt, expiresAt + 5_000)).toBe(0);
  });
});
