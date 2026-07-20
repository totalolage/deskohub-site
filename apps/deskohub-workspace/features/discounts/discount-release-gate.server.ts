import "server-only";

import { Effect } from "effect";
import { nodeFeatureFlags } from "@/features/feature-flags/backend/node";
import { getCurrentPostHogFeatureFlagSubject } from "@/features/feature-flags/backend/subject";
import {
  type DiscountReleaseGateEvaluationSnapshot,
  DiscountReleaseGateEvaluator,
} from "./discount-release-gate.service";

export const DiscountReleaseGateEvaluatorLive =
  DiscountReleaseGateEvaluator.from({
    evaluate: Effect.fn("DiscountReleaseGateEvaluator.evaluate")(() =>
      Effect.Do.pipe(
        Effect.bind("subject", getCurrentPostHogFeatureFlagSubject),
        Effect.bind("snapshot", ({ subject }) =>
          // The typed client uses an eventless snapshot for non-recording subjects.
          nodeFeatureFlags.evaluateFlags({
            options: {
              flagKeys: [
                "calendar_sales",
                "customer_discounts",
                "discount_codes",
              ],
            },
            subject,
          })
        ),
        Effect.map(
          ({ snapshot }) =>
            ({
              getFlag: (flag) => snapshot.getFlag(flag),
            }) satisfies DiscountReleaseGateEvaluationSnapshot
        )
      )
    ),
  });
