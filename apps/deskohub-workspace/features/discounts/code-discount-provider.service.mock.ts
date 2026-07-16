import { Layer } from "effect";
import { CodeDiscountProvider } from "./code-discount-provider.service";

export const CodeDiscountProviderMock = Layer.mock(CodeDiscountProvider);
