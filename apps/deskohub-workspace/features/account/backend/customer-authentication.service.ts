import { Context, Effect, Layer } from "effect";
import { getNeonAuth } from "../auth.server";
import { CustomerAccountAccessError } from "../customer-account";

interface ICustomerAuthentication {
  readonly currentUser: Effect.Effect<
    CustomerAuthUser | null,
    CustomerAccountAccessError
  >;
  readonly deleteUser: Effect.Effect<void, CustomerAccountAccessError>;
  readonly updateName: (
    name: string
  ) => Effect.Effect<void, CustomerAccountAccessError>;
}

export type CustomerAuthUser = {
  readonly email: string;
  readonly emailVerified: boolean;
  readonly id: string;
  readonly name: string;
};

const unavailable = () =>
  new CustomerAccountAccessError({ reason: "unavailable" });

const callNeonAuth = <A>(
  request: (
    auth: NonNullable<ReturnType<typeof getNeonAuth>>
  ) => Promise<{ readonly data: A | null; readonly error: unknown }>
) =>
  Effect.suspend(() => {
    const auth = getNeonAuth();
    if (!auth) {
      return Effect.fail(
        new CustomerAccountAccessError({ reason: "not-configured" })
      );
    }

    return Effect.tryPromise({ try: () => request(auth), catch: unavailable });
  }).pipe(
    Effect.flatMap((result) =>
      result.error ? Effect.fail(unavailable()) : Effect.succeed(result.data)
    )
  );

export class CustomerAuthentication extends Context.Service<
  CustomerAuthentication,
  ICustomerAuthentication
>()("@deskohub-workspace/account/CustomerAuthentication") {
  static Default = Layer.succeed(this, {
    currentUser: callNeonAuth((auth) =>
      auth.getSession({ query: { disableCookieCache: "true" } })
    ).pipe(Effect.map((session) => session?.user ?? null)),
    deleteUser: callNeonAuth((auth) => auth.deleteUser()).pipe(Effect.asVoid),
    updateName: (name) =>
      callNeonAuth((auth) => auth.updateUser({ name })).pipe(Effect.asVoid),
  });
}
