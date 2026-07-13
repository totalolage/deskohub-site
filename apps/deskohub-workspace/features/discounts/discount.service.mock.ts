import { Layer } from "effect";
import { DiscountService } from "./discount.service";

export const DiscountServiceMock = Layer.mock(DiscountService);
