import { cached } from "@deskohub/next-effect/cached";
import { Context, Effect, Layer } from "effect";
import {
  closeUnavailableRelease,
  releaseFromValue,
} from "@/features/feature-flags/backend/release-gate";
import { WorkspaceFeatureFlagService } from "@/features/feature-flags/backend/workspace-feature-flag.service";
import type { PostHogFeatureFlagKey } from "@/features/feature-flags/generated/contract";
import { shareWithinRequest } from "@/shared/backend/share-within-request";

type DiscountReleaseGateOperation =
  | "quote"
  | "discover_active_sales"
  | "discover_advertised_discounts"
  | "affirm_advertisement"
  | "apply_customer_discount"
  | "affirm_displayed_discounts"
  | "apply_discount_code";

export type DiscountReleaseGates = {
  readonly calendarSales: boolean;
  readonly customerDiscounts: boolean;
  readonly discountCodes: boolean;
};

export interface IDiscountReleaseGateService {
  /**
   * The discount gates' one decision. Every operation reads the same
   * decision; the first one to ask annotates the decision's logs.
   */
  readonly evaluate: (input: {
    readonly operation: DiscountReleaseGateOperation;
  }) => Effect.Effect<DiscountReleaseGates>;
}

const discountFlags = [
  "calendar_sales",
  "customer_discounts",
  "discount_codes",
] as const satisfies ReadonlyArray<PostHogFeatureFlagKey>;

const discountReleaseGatesDisabled: DiscountReleaseGates = {
  calendarSales: false,
  customerDiscounts: false,
  discountCodes: false,
};

const decideDiscountReleaseGates = WorkspaceFeatureFlagService.pipe(
  Effect.flatMap((featureFlags) =>
    featureFlags.evaluateFlags({ flagKeys: discountFlags })
  ),
  Effect.flatMap((snapshot) =>
    Effect.all({
      calendarSales: releaseFromValue(
        "calendar_sales",
        snapshot.getFlag("calendar_sales")
      ),
      customerDiscounts: releaseFromValue(
        "customer_discounts",
        snapshot.getFlag("customer_discounts")
      ),
      discountCodes: releaseFromValue(
        "discount_codes",
        snapshot.getFlag("discount_codes")
      ),
    })
  ),
  closeUnavailableRelease(discountFlags, discountReleaseGatesDisabled)
);

// One decision per server render, whichever run or layer asks first.
const requestDiscountReleaseGates = shareWithinRequest(
  decideDiscountReleaseGates
);

const gatesFromDecision = (
  decision: Effect.Effect<DiscountReleaseGates>
): IDiscountReleaseGateService => ({
  evaluate: Effect.fn("DiscountReleaseGateService.evaluate")((input) =>
    decision.pipe(
      Effect.annotateLogs({
        discountBoundary: "release_gate",
        discountOperation: input.operation,
      })
    )
  ),
});

export class DiscountReleaseGateService extends Context.Service<
  DiscountReleaseGateService,
  IDiscountReleaseGateService
>()("@deskohub-workspace/discounts/DiscountReleaseGateService") {
  /**
   * Decides the gates at most once per build of the layer, so one run sees
   * one decision, and shares it with every run and layer of the same server
   * render, so a page and its loaders agree. React `cache` doesn't memoize
   * in a Server Action or route handler, where each build decides once.
   * Never put it in a process-wide runtime layer.
   */
  static Default = Layer.effect(
    this,
    WorkspaceFeatureFlagService.pipe(
      Effect.flatMap((featureFlags) =>
        cached(
          requestDiscountReleaseGates.pipe(
            Effect.provideService(WorkspaceFeatureFlagService, featureFlags)
          )
        )
      ),
      Effect.map(gatesFromDecision)
    )
  );

  static Live = this.Default.pipe(
    Layer.provide(WorkspaceFeatureFlagService.Default)
  );

  /**
   * Gates the caller already decided for this request, for work that must
   * not read the request itself, such as a cached render.
   */
  static fromDecisions = (gates: DiscountReleaseGates) =>
    Layer.succeed(this, gatesFromDecision(Effect.succeed(gates)));
}
