import { Context, Effect, Option } from "effect";
import { HttpClient } from "effect/unstable/http";

interface ICustomerRequestDispatch {
  /** Runs each time the client sends the request, retries included. */
  readonly onSend: Effect.Effect<void>;
}

/**
 * What a request run through `customerRead` or `customerWrite` does at each
 * send: an account read spends the advisory budget once per attempt (the
 * server charges every attempt), a write records that it left the device.
 */
export class CustomerRequestDispatch extends Context.Service<
  CustomerRequestDispatch,
  ICustomerRequestDispatch
>()("CustomerRequestDispatch") {}

/** The client transform that reports each send to the running request. */
export const reportEachSend = (
  client: HttpClient.HttpClient
): HttpClient.HttpClient =>
  HttpClient.tapRequest(client, () =>
    Effect.flatMap(
      Effect.serviceOption(CustomerRequestDispatch),
      Option.match({
        onNone: () => Effect.void,
        onSome: (dispatch) => dispatch.onSend,
      })
    )
  );
