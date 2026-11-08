import { Context, Data, Effect, Layer } from "effect";

/** Better Auth's own answer to whether a request's origin is trusted. */
export interface CustomerRequestOriginAuthority {
  readonly isTrustedOrigin: (origin: string) => Promise<boolean>;
}

/**
 * Better Auth could not say whether an origin is trusted, so the request
 * fails closed. Distinct from an untrusted origin: the request is not shown
 * to be forged, the check is unavailable. It carries no raw failure.
 */
export class CustomerRequestOriginsUnavailableError extends Data.TaggedError(
  "CustomerRequestOriginsUnavailableError"
) {}

interface ICustomerRequestOrigins {
  /**
   * Whether `origin`, a request's `Origin` header, is one Better Auth trusts
   * for its own endpoints. Fails with
   * {@link CustomerRequestOriginsUnavailableError} when Better Auth cannot
   * answer, never by trusting the origin.
   */
  readonly isTrusted: (
    origin: string
  ) => Effect.Effect<boolean, CustomerRequestOriginsUnavailableError>;
}

const originsOver = (
  authority: CustomerRequestOriginAuthority
): ICustomerRequestOrigins => ({
  isTrusted: Effect.fn("CustomerRequestOrigins.isTrusted")(function* (
    origin: string
  ) {
    return yield* Effect.tryPromise({
      try: () => authority.isTrustedOrigin(origin),
      catch: () => new CustomerRequestOriginsUnavailableError(),
    }).pipe(
      Effect.tapError(() =>
        Effect.logWarning("Customer request origin check failed closed.")
      )
    );
  }),
});

/**
 * The origins a customer request may come from: those Better Auth trusts,
 * so the customer API and Better Auth's own endpoints accept the same
 * origins. That covers the allowed hosts and every listed trusted origin,
 * including ones the auth configuration adds later. A `trustedOrigins`
 * callback is asked without a request, so an origin it trusts only for
 * some requests is not trusted here.
 */
export class CustomerRequestOrigins extends Context.Service<
  CustomerRequestOrigins,
  ICustomerRequestOrigins
>()("@deskohub-workspace/account/CustomerRequestOrigins") {
  static fromAuthority = (authority: CustomerRequestOriginAuthority) =>
    Layer.succeed(this, originsOver(authority));

  /**
   * Asks the Workspace's Better Auth context, loading the auth server only
   * when a request asks, as `CustomerAuthentication.Default` does.
   */
  static Default = CustomerRequestOrigins.fromAuthority({
    isTrustedOrigin: async (origin) => {
      const { auth } = await import("@/features/account/server/auth.server");
      return (await auth.$context).isTrustedOrigin(origin);
    },
  });
}
