import "server-only";

import { Effect } from "effect";
import { DiscountReleaseGateServiceLiveWithDependencies } from "./discount.runtime";
import { DiscountReleaseGateService } from "./discount-release-gate.service";

export const getDiscountCodeEntryEnabled = Effect.gen(function* () {
  const releaseGates = yield* DiscountReleaseGateService;
  const gates = yield* releaseGates.evaluate({
    operation: "apply_discount_code",
  });

  return gates.discountCodes;
}).pipe(Effect.provide(DiscountReleaseGateServiceLiveWithDependencies));
