import { Layer } from "effect";
import { DiscountServiceLiveWithDependencies } from "@/features/discounts/discount.runtime";
import { CheckoutPricingService } from "./checkout-pricing.service";

export const CheckoutPricingServiceLiveWithDependencies =
  CheckoutPricingService.Live.pipe(
    Layer.provide(DiscountServiceLiveWithDependencies)
  );
