import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { apiOrigin, authClient } from "../auth/auth-client";
import { nativeCustomerApiTransport } from "./platform-transports";

/**
 * The Expo auth client keeps the session cookie in SecureStore. A failed read
 * sends the request without it; the API's 401 then re-checks the session.
 */
export const customerApiTransportLayer = Layer.merge(
  nativeCustomerApiTransport({
    apiOrigin,
    readSessionCookie: Effect.tryPromise(() => authClient.getCookie()).pipe(
      Effect.orElseSucceed(() => "")
    ),
  }),
  FetchHttpClient.layer
);
