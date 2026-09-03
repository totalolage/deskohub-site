import type { User as BetterAuthUser } from "better-auth";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { headers } from "next/headers";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import {
  CustomerAccountAccessError,
  type CustomerAccountId,
  customerAccountIdSchema,
} from "../customer-account";

/**
 * The closed account-domain view of an authoritative Better Auth session.
 * Better Auth user, provider, and session field types never cross this
 * adapter, so domain code sees only these three facts.
 */
export type CustomerAccountSession = {
  readonly accountId: CustomerAccountId;
  readonly email: typeof reservationCustomerEmailSchema.Type;
  readonly deletionRequested: boolean;
};

const accessError = (reason: CustomerAccountAccessError["reason"]) =>
  new CustomerAccountAccessError({ reason });

export const decodeCustomerAccountSession = (
  session: { readonly user: BetterAuthUser } | null
): Effect.Effect<CustomerAccountSession | null, CustomerAccountAccessError> =>
  Effect.gen(function* () {
    if (!session) return null;

    const accountId = Option.getOrUndefined(
      Schema.decodeOption(customerAccountIdSchema)(session.user.id)
    );
    const email = Option.getOrUndefined(
      Schema.decodeOption(reservationCustomerEmailSchema)(session.user.email)
    );
    if (!accountId || !email) {
      return yield* accessError("unauthenticated");
    }
    if (session.user.emailVerified !== true) {
      return yield* accessError("unverified-email");
    }

    const withDeletionMarker = session.user as BetterAuthUser & {
      deletionRequestedAt?: Date | null;
    };

    return {
      accountId,
      email,
      deletionRequested: withDeletionMarker.deletionRequestedAt != null,
    } satisfies CustomerAccountSession;
  });

const readAuthoritativeSession = () =>
  Effect.tryPromise({
    try: async () => {
      const { auth } = await import("@/features/account/server/auth.server");
      return auth.api.getSession({ headers: await headers() });
    },
    catch: () => accessError("not-configured"),
  });

interface ICustomerAuthentication {
  readonly currentUser: Effect.Effect<
    CustomerAccountSession | null,
    CustomerAccountAccessError
  >;
}

export class CustomerAuthentication extends Context.Service<
  CustomerAuthentication,
  ICustomerAuthentication
>()("@deskohub-workspace/account/CustomerAuthentication") {
  static Default = Layer.succeed(this, {
    currentUser: readAuthoritativeSession().pipe(
      Effect.flatMap(decodeCustomerAccountSession)
    ),
  });
}
