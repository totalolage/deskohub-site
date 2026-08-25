import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Context, Data, Effect, Layer } from "effect";
import type {
  GoodsCart,
  RemoveGoodsCartItemInput,
  SetGoodsCartItemInput,
} from "../goods-cart";
import {
  GoodsCartRepository,
  GoodsCartRevisionConflict,
} from "./goods-cart.repository";

export class GoodsCartUnavailableError extends Data.TaggedError(
  "GoodsCartUnavailableError"
)<{ readonly cause: unknown }> {}

type GoodsCartServiceError =
  | GoodsCartRevisionConflict
  | GoodsCartUnavailableError;

interface IGoodsCartService {
  readonly get: (
    customerId: DotyposCustomerId
  ) => Effect.Effect<GoodsCart, GoodsCartUnavailableError>;
  readonly setItem: (
    customerId: DotyposCustomerId,
    input: SetGoodsCartItemInput
  ) => Effect.Effect<GoodsCart, GoodsCartServiceError>;
  readonly removeItem: (
    customerId: DotyposCustomerId,
    input: RemoveGoodsCartItemInput
  ) => Effect.Effect<GoodsCart, GoodsCartServiceError>;
}

export class GoodsCartService extends Context.Service<
  GoodsCartService,
  IGoodsCartService
>()("@deskohub-workspace/goods/GoodsCartService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const repository = yield* GoodsCartRepository;
      const mapError = <E>(error: E) =>
        error instanceof GoodsCartRevisionConflict
          ? error
          : new GoodsCartUnavailableError({ cause: error });

      const get = Effect.fn("GoodsCartService.get")(
        (customerId: DotyposCustomerId) =>
          repository
            .get(customerId)
            .pipe(
              Effect.mapError(
                (cause) => new GoodsCartUnavailableError({ cause })
              )
            )
      );
      const setItem = Effect.fn("GoodsCartService.setItem")(
        (customerId: DotyposCustomerId, input: SetGoodsCartItemInput) =>
          repository.setItem(customerId, input).pipe(Effect.mapError(mapError))
      );
      const removeItem = Effect.fn("GoodsCartService.removeItem")(
        (customerId: DotyposCustomerId, input: RemoveGoodsCartItemInput) =>
          repository
            .removeItem(customerId, input)
            .pipe(Effect.mapError(mapError))
      );

      return { get, removeItem, setItem } satisfies IGoodsCartService;
    })
  );

  static Live = this.Default.pipe(Layer.provide(GoodsCartRepository.Live));
}

export { GoodsCartRevisionConflict } from "./goods-cart.repository";
