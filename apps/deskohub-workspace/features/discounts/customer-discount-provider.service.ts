import { DotyposService } from "@deskohub/dotypos";
import type { DiscountGroup } from "@deskohub/dotypos/generated";
import { Context, Data, Effect, Layer, Option } from "effect";
import { type Locale, m } from "@/features/i18n";
import type { DiscountProductIdentity, DiscountQuoteInput } from "./contracts";
import { DiscountProviderError } from "./errors";
import { deriveOpaqueDiscountId } from "./opaque-discount-id";
import type { DiscountCandidate } from "./provider";

const providerNamespace = "dotypos-customer-discount";

export type CustomerDiscountProviderInput = Pick<
  DiscountQuoteInput,
  "dotyposCustomerId" | "locale" | "product"
>;

export interface ICustomerDiscountProvider {
  readonly resolve: (
    input: CustomerDiscountProviderInput
  ) => Effect.Effect<readonly DiscountCandidate[], DiscountProviderError>;
}

export class CustomerDiscountConfigurationError extends Data.TaggedError(
  "CustomerDiscountConfigurationError"
)<{
  readonly message: string;
  readonly discountGroupId: string;
  readonly discountPercent: DiscountGroup["discountPercent"];
}> {}

export class CustomerDiscountProvider extends Context.Service<
  CustomerDiscountProvider,
  ICustomerDiscountProvider
>()("@deskohub-workspace/discounts/CustomerDiscountProvider") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const dotypos = yield* DotyposService;

      const resolve = Effect.fn("CustomerDiscountProvider.resolve")(
        (input: CustomerDiscountProviderInput) =>
          Effect.succeed(input).pipe(
            Effect.bind("discountGroup", ({ dotyposCustomerId }) =>
              dotypos
                .getCustomerDiscountGroup({
                  customerId: dotyposCustomerId,
                })
                .pipe(
                  Effect.mapError(
                    (cause) =>
                      new DiscountProviderError({
                        reason: "provider_failure",
                        message:
                          "The Dotypos customer discount could not be loaded.",
                        cause,
                      })
                  )
                )
            ),
            Effect.bind("candidate", toCustomerDiscountCandidate),
            Effect.map(({ candidate }) => Option.toArray(candidate))
          )
      );

      return { resolve } satisfies ICustomerDiscountProvider;
    })
  );
}

const toCustomerDiscountCandidate = (input: {
  readonly discountGroup:
    | {
        readonly discountGroupId: string;
        readonly discountPercent: DiscountGroup["discountPercent"];
      }
    | undefined;
  readonly dotyposCustomerId: string;
  readonly locale: Locale;
  readonly product: DiscountProductIdentity;
}) => {
  if (!input.discountGroup) {
    return Effect.succeed(Option.none<DiscountCandidate>());
  }

  return Effect.succeed({ ...input, discountGroup: input.discountGroup }).pipe(
    Effect.bind("basisPoints", ({ discountGroup }) => {
      const basisPoints = toBasisPoints(discountGroup.discountPercent);

      return basisPoints === undefined
        ? Effect.fail(
            new CustomerDiscountConfigurationError({
              message:
                "Dotypos customer discounts must convert exactly to integer basis points from 1 through 10,000.",
              discountGroupId: discountGroup.discountGroupId,
              discountPercent: discountGroup.discountPercent,
            })
          )
        : Effect.succeed(basisPoints);
    }),
    Effect.map(({ basisPoints, discountGroup, dotyposCustomerId, locale }) =>
      Option.some<DiscountCandidate>({
        discount: {
          id: deriveOpaqueDiscountId({
            providerNamespace,
            providerReference: discountGroup.discountGroupId,
          }),
          label: m.checkoutSummaryItemCustomerDiscount({}, { locale }),
          adjustment: {
            kind: "percentage",
            basisPoints,
          },
        },
        provenance: {
          providerNamespace,
          providerReference: discountGroup.discountGroupId,
          details: {
            discountGroupId: discountGroup.discountGroupId,
            dotyposCustomerId,
          },
        },
      })
    ),
    Effect.mapError(
      (cause) =>
        new DiscountProviderError({
          reason: "malformed_configuration",
          message: "The Dotypos customer discount is malformed.",
          cause,
        })
    )
  );
};

const toBasisPoints = (input: DiscountGroup["discountPercent"]) => {
  const decimal = input?.trim();
  const match = decimal?.match(/^(\d+)(?:\.(\d+))?$/);

  if (!match) {
    return undefined;
  }

  const [, whole = "0", fraction = ""] = match;
  if (/[^0]/.test(fraction.slice(2))) {
    return undefined;
  }

  const basisPoints = Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));

  return Number.isInteger(basisPoints) &&
    basisPoints >= 1 &&
    basisPoints <= 10_000
    ? basisPoints
    : undefined;
};
