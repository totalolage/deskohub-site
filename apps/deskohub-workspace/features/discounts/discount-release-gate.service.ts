import { Context, Effect, Layer, Option } from "effect";
import { WorkspaceFeatureFlagService } from "@/features/feature-flags/backend/workspace-feature-flag.service";
import type { PostHogFeatureFlagKey } from "@/features/feature-flags/generated/contract";

export type DiscountReleaseGateOperation =
  | "discover_advertised_discounts"
  | "affirm_advertisement"
  | "apply_customer_discount"
  | "affirm_for_payment";

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
  static Live = Layer.effect(
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
            Effect.bind("calendarSales", ({ snapshot }) =>
              resolveReleaseGate({
                flag: "calendar_sales",
                operation: input.operation,
                value: snapshot.getFlag("calendar_sales"),
              })
            ),
            Effect.bind("customerDiscounts", ({ snapshot }) =>
              resolveReleaseGate({
                flag: "customer_discounts",
                operation: input.operation,
                value: snapshot.getFlag("customer_discounts"),
              })
            ),
            Effect.bind("discountCodes", ({ snapshot }) =>
              resolveReleaseGate({
                flag: "discount_codes",
                operation: input.operation,
                value: snapshot.getFlag("discount_codes"),
              })
            ),
            Effect.map(
              ({ calendarSales, customerDiscounts, discountCodes }) =>
                ({
                  calendarSales,
                  customerDiscounts,
                  discountCodes,
                }) satisfies DiscountReleaseGates
            ),
            Effect.catch((error) =>
              Effect.logError("Discount release gate evaluation failed").pipe(
                Effect.annotateLogs({
                  discountBoundary: "release_gate",
                  discountOperation: input.operation,
                  discountErrorTag: error._tag,
                  discountErrorReason: "evaluation_failure",
                }),
                Effect.as(discountReleaseGatesDisabled)
              )
            )
          )
        ),
      } satisfies IDiscountReleaseGateService;
    })
  );
}

const discountReleaseGatesDisabled: DiscountReleaseGates = {
  calendarSales: false,
  customerDiscounts: false,
  discountCodes: false,
};

const resolveReleaseGate = Effect.fn(
  "DiscountReleaseGateService.resolveReleaseGate"
)(
  (input: {
    readonly flag: PostHogFeatureFlagKey;
    readonly operation: DiscountReleaseGateOperation;
    readonly value: boolean | undefined;
  }) =>
    Option.fromNullishOr(input.value).pipe(
      Option.map((value) => Effect.succeed(value === true)),
      Option.getOrElse(() =>
        Effect.logError("Discount release gate is unavailable").pipe(
          Effect.annotateLogs({
            discountBoundary: "release_gate",
            discountOperation: input.operation,
            discountFeatureFlag: input.flag,
            discountErrorTag: "MissingFeatureFlag",
            discountErrorReason: "missing_flag",
          }),
          Effect.as(false)
        )
      )
    )
);
