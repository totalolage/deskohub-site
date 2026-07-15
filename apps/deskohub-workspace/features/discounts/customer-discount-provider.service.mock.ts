import { Layer } from "effect";
import { CustomerDiscountProvider } from "./customer-discount-provider.service";

export const CustomerDiscountProviderMock = Layer.mock(
  CustomerDiscountProvider
);
