import { Layer } from "effect";
import { PromotionCodeProvider } from "./promotion-code-provider.service";

export const PromotionCodeProviderMock = Layer.mock(PromotionCodeProvider);
