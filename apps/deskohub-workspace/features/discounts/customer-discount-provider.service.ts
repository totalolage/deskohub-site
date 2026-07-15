import { DotyposService } from "@deskohub/dotypos";
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
  readonly quote: (
    input: CustomerDiscountProviderInput
  ) => Effect.Effect<readonly DiscountCandidate[], DiscountProviderError>;
  readonly revalidate: (
    input: CustomerDiscountProviderInput
  ) => Effect.Effect<readonly DiscountCandidate[], DiscountProviderError>;
}

export class CustomerDiscountConfigurationError extends Data.TaggedError(
  "CustomerDiscountConfigurationError"
)<{
  readonly message: string;
  readonly discountGroupId: string;
  readonly discountPercent: unknown;
}> {}

export class CustomerDiscountProvider extends Context.Service<
  CustomerDiscountProvider,
  ICustomerDiscountProvider
>()("@deskohub-workspace/discounts/CustomerDiscountProvider") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const dotypos = yield* DotyposService;

      const loadCustomerDiscount = (input: CustomerDiscountProviderInput) =>
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
        );

      const quote = Effect.fn("CustomerDiscountProvider.quote")(
        loadCustomerDiscount
      );
      const revalidate = Effect.fn("CustomerDiscountProvider.revalidate")(
        loadCustomerDiscount
      );

      return { quote, revalidate } satisfies ICustomerDiscountProvider;
    })
  );
}

const toCustomerDiscountCandidate = (input: {
  readonly discountGroup:
    | {
        readonly discountGroupId: string;
        readonly discountPercent: unknown;
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

const toBasisPoints = (input: unknown) => {
  const decimal =
    typeof input === "number" && Number.isFinite(input)
      ? String(input)
      : typeof input === "string"
        ? input.trim()
        : undefined;
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
