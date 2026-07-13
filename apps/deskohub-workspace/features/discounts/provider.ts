import { Context, type Effect } from "effect";
import type { Discount, DiscountQuoteInput } from "./contracts";
import type {
  DiscountCodeUnavailableError,
  DiscountProviderError,
} from "./errors";

export type DiscountProvenance = {
  readonly providerNamespace: string;
  readonly providerReference: string;
  readonly details?: Readonly<Record<string, unknown>>;
};

export type DiscountClaimInstruction = {
  readonly kind: "discount_code";
  readonly codeId: string;
  readonly dotyposCustomerId: string;
};

export type DiscountCandidate = {
  readonly discount: Discount;
  readonly provenance: DiscountProvenance;
  readonly claim?: DiscountClaimInstruction;
};

type DiscountProviderErrorType =
  | DiscountCodeUnavailableError
  | DiscountProviderError;

type CustomerDiscountProviderInput = Pick<
  DiscountQuoteInput,
  "dotyposCustomerId" | "locale" | "product"
>;

type CodeDiscountProviderInput = Pick<
  DiscountQuoteInput,
  "discountableSubtotal" | "dotyposCustomerId" | "product" | "submittedCode"
>;

interface ICustomerDiscountProvider {
  readonly quote: (
    input: CustomerDiscountProviderInput
  ) => Effect.Effect<readonly DiscountCandidate[], DiscountProviderError>;
  readonly revalidate: (
    input: CustomerDiscountProviderInput
  ) => Effect.Effect<readonly DiscountCandidate[], DiscountProviderError>;
}

interface ICodeDiscountProvider {
  readonly quote: (
    input: CodeDiscountProviderInput
  ) => Effect.Effect<readonly DiscountCandidate[], DiscountProviderErrorType>;
  readonly revalidate: (
    input: CodeDiscountProviderInput
  ) => Effect.Effect<readonly DiscountCandidate[], DiscountProviderErrorType>;
}

export class CustomerDiscountProvider extends Context.Service<
  CustomerDiscountProvider,
  ICustomerDiscountProvider
>()("@deskohub-workspace/discounts/CustomerDiscountProvider") {}

export class CodeDiscountProvider extends Context.Service<
  CodeDiscountProvider,
  ICodeDiscountProvider
>()("@deskohub-workspace/discounts/CodeDiscountProvider") {}
