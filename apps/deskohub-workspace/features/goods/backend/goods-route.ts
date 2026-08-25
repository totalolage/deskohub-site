import { Effect, Schema } from "effect";
import {
  type CustomerAccountAccessError,
  CustomerAccountResolver,
} from "@/features/account";
import { WorkspaceRouteFailure } from "@/shared/backend/workspace-route";

export const resolveGoodsCustomerId = Effect.fn("goodsRoute.resolveCustomerId")(
  function* () {
    const resolver = yield* CustomerAccountResolver;
    const account = yield* resolver
      .resolve()
      .pipe(Effect.mapError((cause) => customerAccountRouteFailure(cause)));
    return account.dotyposCustomerId;
  }
);

export const decodeGoodsRequest = <A>(
  request: Request,
  schema: Schema.Decoder<A>,
  publicMessage = "Goods request is invalid."
) =>
  Effect.tryPromise({
    try: () => request.json(),
    catch: (cause) =>
      new WorkspaceRouteFailure({
        statusCode: 400,
        publicMessage: "Request body must be valid JSON.",
        cause,
      }),
  }).pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(schema, {
        errors: "all",
        onExcessProperty: "error",
      })
    ),
    Effect.mapError((cause) =>
      cause instanceof WorkspaceRouteFailure
        ? cause
        : new WorkspaceRouteFailure({
            statusCode: 400,
            publicMessage,
            cause,
          })
    )
  );

const customerAccountRouteFailure = (
  cause: CustomerAccountAccessError
): WorkspaceRouteFailure => {
  if (cause.reason === "unauthenticated") {
    return new WorkspaceRouteFailure({
      statusCode: 401,
      publicMessage: "Authentication is required.",
      cause,
    });
  }
  if (cause.reason === "unverified-email" || cause.reason === "link-required") {
    return new WorkspaceRouteFailure({
      statusCode: 403,
      publicMessage: "A linked customer account is required.",
      cause,
    });
  }
  return new WorkspaceRouteFailure({
    statusCode: 503,
    publicMessage: "Customer account access is temporarily unavailable.",
    cause,
  });
};
