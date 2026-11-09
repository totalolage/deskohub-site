import type {
  CustomerCheckoutSummary,
  CustomerCheckoutSummaryItem,
  CustomerLegalDocument,
  Money,
} from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import { canPay } from "../checkout/checkout-machine";
import type {
  CodeStatus,
  HeldCheckout,
  ReviewState,
} from "../checkout/checkout-state";
import type {
  SummaryLineKind,
  SummaryLineView,
  SummaryView,
} from "../ui/price-summary";

export const summaryLineKind = (key: string): SummaryLineKind => {
  const [prefix, ...rest] = key.split(":");
  const name = rest.join(":");
  if (prefix === "product") return { _tag: "Product", product: name };
  if (key === "addon:coffee") return { _tag: "Coffee" };
  if (key === "addon:workstation") return { _tag: "Workstation" };
  if (prefix === "monitor") return { _tag: "Monitor", option: name };
  return { _tag: "Other", key };
};

/** The changed lines and sections a price review names. */
export type ChangedKeys = Option.Option<
  Option.Option.Value<HeldCheckout["priceReview"]>
>;

const totalKey = "total:final";

const lineView = (
  item: CustomerCheckoutSummaryItem,
  changed: (key: string) => boolean
): SummaryLineView => ({
  key: item.key,
  kind: summaryLineKind(item.key),
  amount: item.amount,
  originalAmount: Option.fromUndefinedOr(item.originalAmount),
  discounts: (item.discounts ?? []).map(({ discount, amount }) => ({
    label: discount.label,
    amount,
  })),
  office: Option.all({
    dayCount: Option.fromUndefinedOr(item.dayCount),
    seats: Option.fromUndefinedOr(item.seats),
  }).pipe(
    Option.map((counts) => ({
      ...counts,
      accessAmount: Option.fromUndefinedOr(item.accessAmount),
      // `seatAmount` is one seat's price for the days booked.
      seatTotal: Option.map(
        Option.fromUndefinedOr(item.seatAmount),
        (seat): Money => ({ ...seat, value: seat.value * counts.seats })
      ),
    }))
  ),
  changed: changed(item.key),
});

/**
 * The itemized summary (no VAT line: the summary has none), with the lines
 * a price review changed marked. A line is marked when its own key changed
 * (a section changes when its total does, which says nothing about its
 * other lines, as on the site); the total is marked when its section or the
 * final total line changed.
 */
export const summaryView = (
  summary: CustomerCheckoutSummary,
  changedKeys: ChangedKeys
): SummaryView => {
  const changed = Option.getOrElse(changedKeys, () => ({
    sectionKeys: [] as ReadonlyArray<string>,
    itemKeys: [] as ReadonlyArray<string>,
  }));
  const lines = summary.sections.flatMap((section) =>
    section.items
      .filter((item) => item.key !== totalKey)
      .map((item) => lineView(item, (key) => changed.itemKeys.includes(key)))
  );
  return {
    lines,
    total: summary.total,
    totalChanged:
      changed.sectionKeys.includes("total") ||
      changed.itemKeys.includes(totalKey),
  };
};

/**
 * - `Applying` / `Applied` / `Rejected`: the code's latest outcome.
 * - `AwaitingPriceAcceptance`: accept the new price, then apply the code
 *   again.
 * - `Retryable`: the code couldn't be checked (`unavailable`, R5); the
 *   customer can apply it again, it isn't marked invalid.
 */
export type CodeMessage =
  | { readonly _tag: "None" }
  | { readonly _tag: "Applying" }
  | {
      readonly _tag: "Applied";
      readonly outcome: "applied" | "referral_accepted";
    }
  | { readonly _tag: "AwaitingPriceAcceptance" }
  | { readonly _tag: "Retryable" }
  | {
      readonly _tag: "Rejected";
      readonly reason:
        | "already_attributed"
        | "ineligible"
        | "code_already_applied";
    };

const codeMessage = (status: CodeStatus): CodeMessage => {
  switch (status._tag) {
    case "Idle":
      return { _tag: "None" };
    case "Applying":
      return { _tag: "Applying" };
    case "Applied":
      return { _tag: "Applied", outcome: status.outcome };
    case "AwaitingPriceAcceptance":
      return { _tag: "AwaitingPriceAcceptance" };
    case "Rejected":
      return status.reason === "unavailable"
        ? { _tag: "Retryable" }
        : { _tag: "Rejected", reason: status.reason };
  }
};

export interface CodeFieldView {
  readonly input: string;
  /** Holds still while any write runs. */
  readonly editable: boolean;
  readonly canApply: boolean;
  readonly message: CodeMessage;
}

export type LegalView =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Failed" }
  | {
      readonly _tag: "Loaded";
      readonly documents: ReadonlyArray<CustomerLegalDocument>;
    };

export interface ConsentView {
  readonly legal: LegalView;
  readonly checked: boolean;
  readonly disabled: boolean;
  /** The checkbox also requests starting before the withdrawal period ends. */
  readonly earlyPerformance: boolean;
}

export interface ReviewView {
  readonly summary: SummaryView;
  /** A changed price waits for the customer's acceptance. */
  readonly priceReview: boolean;
  readonly acceptingPrice: boolean;
  readonly code: CodeFieldView;
  readonly consent: ConsentView;
  readonly canPay: boolean;
  /** A write runs: every other review action holds still. */
  readonly busy: boolean;
  readonly submitting: boolean;
  /** Whole seconds left on the hold at the flow clock's latest tick. */
  readonly holdSecondsLeft: number;
}

const pendingIs =
  (review: ReviewState) =>
  (tag: "ApplyDiscountCode" | "AcceptPriceChange" | "SubmitCheckout") =>
    Option.exists(review.pending, (pending) => pending._tag === tag);

export const reviewView = (review: ReviewState, now: number): ReviewView => {
  const idle = Option.isNone(review.pending);
  const pending = pendingIs(review);
  const { checkout, code, legal } = review;
  return {
    summary: summaryView(checkout.summary, checkout.priceReview),
    priceReview: Option.isSome(checkout.priceReview),
    acceptingPrice: pending("AcceptPriceChange"),
    code: {
      input: code.input,
      editable: idle,
      canApply: idle && code.input.trim() !== "",
      message: codeMessage(code.status),
    },
    consent: {
      legal,
      checked: Option.isSome(review.consent),
      disabled: !idle || legal._tag !== "Loaded",
      earlyPerformance: checkout.earlyPerformanceConsent.required,
    },
    canPay: canPay(review),
    busy: !idle,
    submitting: pending("SubmitCheckout"),
    holdSecondsLeft: holdSecondsLeft(Date.parse(checkout.expiresAt), now),
  };
};

/** Whole seconds left on the hold at `now` (epoch ms), never below zero. */
export const holdSecondsLeft = (expiresAt: number, now: number): number =>
  Math.max(0, Math.ceil((expiresAt - now) / 1000));
