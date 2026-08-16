import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Clock, Context, Data, Effect, Layer, type Option } from "effect";
import {
  DiscountClaimError,
  type GoodsBasketDiscountCommitment,
} from "@/features/discounts";
import type { OrderId } from "@/features/order";
import type {
  GoodsOrderDetail,
  GoodsOrderIssuanceFacts,
  GoodsOrderSummary,
  IssueGoodsOrderRequest,
} from "../goods-order";
import {
  GoodsOrderCartChangedError,
  GoodsOrderIssuanceConflictError,
  GoodsOrderNotFoundError,
  GoodsOrderRepository,
} from "./goods-order.repository";
import { getGoodsOrderIssuanceFingerprint } from "./goods-order-issuance-fingerprint";

export class GoodsOrderUnavailableError extends Data.TaggedError(
  "GoodsOrderUnavailableError"
)<{ readonly cause: unknown }> {}

export type IssueGoodsOrderInput = GoodsOrderIssuanceFacts & {
  readonly customerId: DotyposCustomerId;
  readonly request: Pick<IssueGoodsOrderRequest, "acknowledged" | "quoteToken">;
  readonly discountCommitment?: GoodsBasketDiscountCommitment;
};

type IssueGoodsOrderError =
  | GoodsOrderCartChangedError
  | GoodsOrderIssuanceConflictError
  | GoodsOrderUnavailableError
  | DiscountClaimError;

interface IGoodsOrderService {
  readonly issue: (
    input: IssueGoodsOrderInput
  ) => Effect.Effect<GoodsOrderDetail, IssueGoodsOrderError>;
  readonly list: (
    customerId: DotyposCustomerId
  ) => Effect.Effect<readonly GoodsOrderSummary[], GoodsOrderUnavailableError>;
  readonly findByIssuanceRequest: (
    customerId: DotyposCustomerId,
    request: IssueGoodsOrderRequest
  ) => Effect.Effect<
    Option.Option<GoodsOrderDetail>,
    GoodsOrderIssuanceConflictError | GoodsOrderUnavailableError
  >;
  readonly get: (
    customerId: DotyposCustomerId,
    orderId: OrderId
  ) => Effect.Effect<
    GoodsOrderDetail,
    GoodsOrderNotFoundError | GoodsOrderUnavailableError
  >;
}

export class GoodsOrderService extends Context.Service<
  GoodsOrderService,
  IGoodsOrderService
>()("@deskohub-workspace/goods/GoodsOrderService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const repository = yield* GoodsOrderRepository;

      return {
        issue: Effect.fn("GoodsOrderService.issue")((input) =>
          Clock.currentTimeMillis.pipe(
            Effect.map(Temporal.Instant.fromEpochMilliseconds),
            Effect.flatMap((issuedAt) => {
              const { request, ...facts } = input;
              return repository.issue({
                ...facts,
                issuedAt,
                issuanceFingerprint: getGoodsOrderIssuanceFingerprint(request),
              });
            }),
            Effect.mapError((error) =>
              error instanceof GoodsOrderCartChangedError ||
              error instanceof GoodsOrderIssuanceConflictError ||
              error instanceof DiscountClaimError
                ? error
                : new GoodsOrderUnavailableError({ cause: error })
            )
          )
        ),
        list: Effect.fn("GoodsOrderService.list")((customerId) =>
          repository
            .list(customerId)
            .pipe(
              Effect.mapError(
                (cause) => new GoodsOrderUnavailableError({ cause })
              )
            )
        ),
        findByIssuanceRequest: Effect.fn(
          "GoodsOrderService.findByIssuanceRequest"
        )((customerId, request) =>
          repository
            .findByIssuanceId(
              customerId,
              request.issuanceId,
              getGoodsOrderIssuanceFingerprint(request)
            )
            .pipe(
              Effect.mapError((error) =>
                error instanceof GoodsOrderIssuanceConflictError
                  ? error
                  : new GoodsOrderUnavailableError({ cause: error })
              )
            )
        ),
        get: Effect.fn("GoodsOrderService.get")((customerId, orderId) =>
          repository
            .get(customerId, orderId)
            .pipe(
              Effect.mapError((error) =>
                error instanceof GoodsOrderNotFoundError
                  ? error
                  : new GoodsOrderUnavailableError({ cause: error })
              )
            )
        ),
      } satisfies IGoodsOrderService;
    })
  );

  static Live = this.Default.pipe(Layer.provide(GoodsOrderRepository.Live));
}

export {
  GoodsOrderCartChangedError,
  GoodsOrderIssuanceConflictError,
  GoodsOrderNotFoundError,
};
