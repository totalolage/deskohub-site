import { Context, Effect, Layer } from "effect";
import { WorkspaceFeatureFlagService } from "@/features/feature-flags/backend/workspace-feature-flag.service";

export type DiscountReleaseGateOperation =
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
  readonly evaluate: (input: {
    readonly operation: DiscountReleaseGateOperation;
  }) => Effect.Effect<DiscountReleaseGates>;
}

export class DiscountReleaseGateService extends Context.Service<
  DiscountReleaseGateService,
  IDiscountReleaseGateService
>()("@deskohub-workspace/discounts/DiscountReleaseGateService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const featureFlags = yield* WorkspaceFeatureFlagService;

      return {
        evaluate: Effect.fn("DiscountReleaseGateService.evaluate")((input) =>
          Effect.Do.pipe(
            Effect.bind("snapshot", () =>
              featureFlags.evaluateFlags({
                flagKeys: [
                  "calendar_sales",
                  "customer_discounts",
                  "discount_codes",
                ],
              })
            ),
            Effect.let("calendarSales", ({ snapshot }) =>
              snapshot.isEnabled("calendar_sales")
            ),
            Effect.let("customerDiscounts", ({ snapshot }) =>
              snapshot.isEnabled("customer_discounts")
            ),
            Effect.let("discountCodes", ({ snapshot }) =>
              snapshot.isEnabled("discount_codes")
            ),
            Effect.map(
              ({ calendarSales, customerDiscounts, discountCodes }) =>
                ({
                  calendarSales,
                  customerDiscounts,
                  discountCodes,
                }) satisfies DiscountReleaseGates
            ),
            Effect.tapError((error) =>
              Effect.logError("Discount release gate evaluation failed").pipe(
                Effect.annotateLogs({
                  discountBoundary: "release_gate",
                  discountOperation: input.operation,
                  discountErrorTag: error._tag,
                  discountErrorReason: "evaluation_failure",
                })
              )
            ),
            Effect.orElseSucceed(() => discountReleaseGatesDisabled)
          )
        ),
      } satisfies IDiscountReleaseGateService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(WorkspaceFeatureFlagService.Default)
  );
}

const discountReleaseGatesDisabled: DiscountReleaseGates = {
  calendarSales: false,
  customerDiscounts: false,
  discountCodes: false,
};
