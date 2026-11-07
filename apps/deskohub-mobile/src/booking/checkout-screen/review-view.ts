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

/** What a summary line is, from its key (`CustomerCheckoutSummaryItem.key`). */
export type SummaryLineKind =
  | { readonly _tag: "Product"; readonly product: string }
  | { readonly _tag: "Coffee" }
  | { readonly _tag: "Workstation" }
  | { readonly _tag: "Monitor"; readonly option: string }
  | { readonly _tag: "Other"; readonly key: string };

export const summaryLineKind = (key: string): SummaryLineKind => {
  const [prefix, ...rest] = key.split(":");
  const name = rest.join(":");
  if (prefix === "product") return { _tag: "Product", product: name };
  if (key === "addon:coffee") return { _tag: "Coffee" };
  if (key === "addon:workstation") return { _tag: "Workstation" };
  if (prefix === "monitor") return { _tag: "Monitor", option: name };
  return { _tag: "Other", key };
};

/** One summary line as the review shows it. */
export interface SummaryLineView {
  readonly key: string;
  readonly kind: SummaryLineKind;
  readonly amount: Money;
  /** The price before discounts, on a discounted line. */
  readonly originalAmount: Option.Option<Money>;
  readonly discounts: ReadonlyArray<{
    readonly label: string;
    readonly amount: Money;
  }>;
  /** Office lines: the days and seats booked, with each part's price. */
  readonly office: Option.Option<{
    readonly dayCount: number;
    readonly seats: number;
    readonly accessAmount: Option.Option<Money>;
    readonly seatAmount: Option.Option<Money>;
  }>;
  /** The price review names this line as changed. */
  readonly changed: boolean;
}

export interface SummaryView {
  readonly lines: ReadonlyArray<SummaryLineView>;
  readonly total: Money;
  readonly totalChanged: boolean;
}

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
      seatAmount: Option.fromUndefinedOr(item.seatAmount),
    }))
  ),
  changed: changed(item.key),
});

/**
 * The itemized summary (no VAT line: the summary has none), with the lines
 * a price review changed marked. A changed section marks all its lines; the
 * total is marked when its section or the final total line changed.
 */
export const summaryView = (
  summary: CustomerCheckoutSummary,
  changedKeys: ChangedKeys
): SummaryView => {
  const changed = Option.getOrElse(changedKeys, () => ({
    sectionKeys: [] as ReadonlyArray<string>,
    itemKeys: [] as ReadonlyArray<string>,
  }));
  const lines = summary.sections.flatMap((section) => {
    const sectionChanged = changed.sectionKeys.includes(section.key);
    return section.items
      .filter((item) => item.key !== totalKey)
      .map((item) =>
        lineView(
          item,
          (key) => sectionChanged || changed.itemKeys.includes(key)
        )
      );
  });
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
  readonly submitting: boolean;
  readonly expiresAt: number;
}

const pendingIs =
  (review: ReviewState) =>
  (tag: "ApplyDiscountCode" | "AcceptPriceChange" | "SubmitCheckout") =>
    Option.exists(review.pending, (pending) => pending._tag === tag);

export const reviewView = (review: ReviewState): ReviewView => {
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
    submitting: pending("SubmitCheckout"),
    expiresAt: Date.parse(checkout.expiresAt),
  };
};

/** Whole seconds left on the hold at `now` (epoch ms), never below zero. */
export const holdSecondsLeft = (expiresAt: number, now: number): number =>
  Math.max(0, Math.ceil((expiresAt - now) / 1000));
