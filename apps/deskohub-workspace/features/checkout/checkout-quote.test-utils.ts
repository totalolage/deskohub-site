import type { DotyposCustomerDiscount } from "@deskohub/dotypos";
import { Effect } from "effect";
import {
  calculateWorkspaceCheckoutQuote,
  type WorkspaceCheckoutOrder,
  type WorkspaceCheckoutQuote,
} from "./checkout-quote";

export const buildWorkspaceCheckoutQuote = (
  order: WorkspaceCheckoutOrder,
  options: {
    readonly customerDiscount?: DotyposCustomerDiscount;
    readonly currencyOverride?: string;
  } = {}
): WorkspaceCheckoutQuote =>
  Effect.runSync(calculateWorkspaceCheckoutQuote(order, options));
