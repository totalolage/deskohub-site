import { Layer } from "effect";
import { ReviewSandbox } from "./review-sandbox.service";

export const ReviewSandboxMock = Layer.mock(ReviewSandbox);
