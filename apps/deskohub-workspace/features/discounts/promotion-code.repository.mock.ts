import { Layer } from "effect";
import { PromotionCodeRepository } from "./promotion-code.repository";

export const PromotionCodeRepositoryMock = Layer.mock(PromotionCodeRepository);
