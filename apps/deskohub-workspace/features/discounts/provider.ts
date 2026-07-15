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

type CodeDiscountProviderInput = Pick<
  DiscountQuoteInput,
  "discountableSubtotal" | "dotyposCustomerId" | "product" | "submittedCode"
>;

interface ICodeDiscountProvider {
  readonly quote: (
    input: CodeDiscountProviderInput
  ) => Effect.Effect<readonly DiscountCandidate[], DiscountProviderErrorType>;
  readonly revalidate: (
    input: CodeDiscountProviderInput
  ) => Effect.Effect<readonly DiscountCandidate[], DiscountProviderErrorType>;
}

export class CodeDiscountProvider extends Context.Service<
  CodeDiscountProvider,
  ICodeDiscountProvider
>()("@deskohub-workspace/discounts/CodeDiscountProvider") {}
