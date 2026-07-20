import type { PostHogFeatureFlagEvaluationError } from "@deskohub/posthog/feature-flags/node";
import { Context, Effect, Layer } from "effect";

export type DiscountReleaseGates = {
  readonly calendarSales: boolean;
  readonly customerDiscounts: boolean;
  readonly discountCodes: boolean;
};

type DiscountOperation = "quote" | "affirm";

export type DiscountReleaseFeatureFlag =
  | "calendar_sales"
  | "customer_discounts"
  | "discount_codes";

export interface DiscountReleaseGateEvaluationSnapshot {
  readonly getFlag: (flag: DiscountReleaseFeatureFlag) => boolean | undefined;
}

export interface IDiscountReleaseGateEvaluator {
  readonly evaluate: () => Effect.Effect<
    DiscountReleaseGateEvaluationSnapshot,
    PostHogFeatureFlagEvaluationError
  >;
}

export class DiscountReleaseGateEvaluator extends Context.Service<
  DiscountReleaseGateEvaluator,
  IDiscountReleaseGateEvaluator
>()("@deskohub-workspace/discounts/DiscountReleaseGateEvaluator") {
  static from = (implementation: IDiscountReleaseGateEvaluator) =>
    Layer.succeed(this, implementation);
}

export interface IDiscountReleaseGateService {
  readonly evaluate: (input: {
    readonly operation: DiscountOperation;
  }) => Effect.Effect<DiscountReleaseGates>;
}

export class DiscountReleaseGateService extends Context.Service<
  DiscountReleaseGateService,
  IDiscountReleaseGateService
>()("@deskohub-workspace/discounts/DiscountReleaseGateService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const evaluator = yield* DiscountReleaseGateEvaluator;

      return {
        evaluate: Effect.fn("DiscountReleaseGateService.evaluate")((input) =>
          Effect.Do.pipe(
            Effect.bind("snapshot", evaluator.evaluate),
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
    readonly flag: DiscountReleaseFeatureFlag;
    readonly operation: DiscountOperation;
    readonly value: boolean | undefined;
  }) =>
    input.value === undefined
      ? Effect.logError("Discount release gate is unavailable").pipe(
          Effect.annotateLogs({
            discountBoundary: "release_gate",
            discountOperation: input.operation,
            discountFeatureFlag: input.flag,
            discountErrorTag: "MissingFeatureFlag",
            discountErrorReason: "missing_flag",
          }),
          Effect.as(false)
        )
      : Effect.succeed(input.value === true)
);
