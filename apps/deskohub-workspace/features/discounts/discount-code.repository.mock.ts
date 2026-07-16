import { Layer } from "effect";
import { DiscountCodeRepository } from "./discount-code.repository";

export const DiscountCodeRepositoryMock = Layer.mock(DiscountCodeRepository);
