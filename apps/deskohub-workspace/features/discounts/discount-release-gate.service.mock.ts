import { Layer } from "effect";
import { DiscountReleaseGateService } from "./discount-release-gate.service";

export const DiscountReleaseGateServiceMock = Layer.mock(
  DiscountReleaseGateService
);
