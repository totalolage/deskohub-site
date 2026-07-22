import { Layer } from "effect";
import { CheckoutPricingService } from "./checkout-pricing.service";

export const CheckoutPricingServiceMock = Layer.mock(CheckoutPricingService);
